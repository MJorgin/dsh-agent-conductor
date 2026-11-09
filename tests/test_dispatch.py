import contextlib
import importlib.util
import io
import os
import subprocess
import sys
import time
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).parents[1] / "skills" / "conductor" / "scripts" / "dispatch.py"
SPEC = importlib.util.spec_from_file_location("dispatch", MODULE_PATH)
dispatch = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(dispatch)


class ConductorDryRunTests(unittest.TestCase):
    def test_render_plan_returns_preview_without_execution(self):
        output = io.StringIO()
        with mock.patch.object(dispatch, "resolve_binary", return_value="/usr/bin/fake-codex"):
            with mock.patch.object(dispatch, "load_conf", return_value=None):
                with contextlib.redirect_stdout(output):
                    code = dispatch.render_plan(
                        "codex",
                        dispatch.AGENTS["codex"],
                        "inspect only",
                        "/tmp/project",
                    )

        rendered = output.getvalue()
        self.assertEqual(code, 0)
        self.assertIn("Dry-run", rendered)
        self.assertIn("/tmp/project", rendered)
        self.assertIn("/usr/bin/fake-codex", rendered)
        self.assertIn("inspect only", rendered)
        self.assertIn("no shell is used", rendered)

    def test_main_dry_run_does_not_spawn_subprocess(self):
        output = io.StringIO()
        argv = ["dispatch.py", "--dry-run", "codex", "preview this task"]
        with mock.patch.object(sys, "argv", argv):
            with mock.patch.object(dispatch, "resolve_binary", return_value="/usr/bin/fake-codex"):
                with mock.patch.object(dispatch, "load_conf", return_value=None):
                    with mock.patch.object(dispatch.subprocess, "run") as run:
                        with contextlib.redirect_stdout(output):
                            with self.assertRaises(SystemExit) as raised:
                                dispatch.main()

        self.assertEqual(raised.exception.code, 0)
        run.assert_not_called()
        self.assertIn("Arguments", output.getvalue())

    def test_dry_run_text_is_not_treated_as_a_flag(self):
        output = io.StringIO()
        argv = ["dispatch.py", "--dry-run", "codex", "keep --dry-run in the task text"]
        with mock.patch.object(sys, "argv", argv):
            with mock.patch.object(dispatch, "resolve_binary", return_value="/usr/bin/fake-codex"):
                with mock.patch.object(dispatch, "load_conf", return_value=None):
                    with contextlib.redirect_stdout(output):
                        with self.assertRaises(SystemExit) as raised:
                            dispatch.main()

        self.assertEqual(raised.exception.code, 0)
        self.assertIn("keep --dry-run in the task text", output.getvalue())

    def test_unknown_agent_fails_before_dispatch(self):
        argv = ["dispatch.py", "not-an-agent", "do work"]
        with mock.patch.object(sys, "argv", argv):
            with mock.patch.object(dispatch.subprocess, "run") as run:
                with self.assertRaises(SystemExit) as raised:
                    dispatch.main()

        self.assertNotEqual(raised.exception.code, 0)
        run.assert_not_called()


class BuildArgvTests(unittest.TestCase):
    def test_codex_model_override_is_inserted_after_exec(self):
        with mock.patch.object(dispatch, "load_conf", return_value="gpt-5-codex"):
            argv = dispatch.build_argv("codex", dispatch.AGENTS["codex"], "do it")
        self.assertEqual(argv, ["codex", "exec", "-m", "gpt-5-codex", "do it"])

    def test_other_agents_ignore_the_codex_override(self):
        with mock.patch.object(dispatch, "load_conf", return_value="gpt-5-codex"):
            argv = dispatch.build_argv("claude-code", dispatch.AGENTS["claude-code"], "hi")
        self.assertEqual(argv, ["claude", "-p", "hi", "--output-format", "text"])


class ResolvedArgvTests(unittest.TestCase):
    def test_resolved_program_replaces_bare_name(self):
        with mock.patch.object(dispatch, "resolve_binary", return_value="C:/tools/codex.CMD"):
            argv = dispatch.resolved_argv(dispatch.AGENTS["codex"], ["codex", "exec", "task"])
        self.assertEqual(argv, ["C:/tools/codex.CMD", "exec", "task"])

    def test_missing_binary_keeps_bare_argv(self):
        with mock.patch.object(dispatch, "resolve_binary", return_value=None):
            argv = dispatch.resolved_argv(dispatch.AGENTS["codex"], ["codex", "exec", "task"])
        self.assertEqual(argv, ["codex", "exec", "task"])


def fill_buffer(text, head_cap=dispatch.MAX_OUTPUT_CHARS, tail_cap=dispatch.TAIL_CHARS, chunk=4096):
    buf = dispatch._OutputBuffer(head_cap, tail_cap)
    for start in range(0, len(text), chunk):
        buf.feed(text[start:start + chunk])
    return buf


class OutputBufferTests(unittest.TestCase):
    def test_over_long_output_keeps_true_tail_and_true_total(self):
        payload = "HEAD" + "x" * 100_000 + "FINAL-ANSWER"
        buf = fill_buffer(payload)
        clipped = dispatch.clip(buf.head(), buf.tail, buf.total)
        self.assertTrue(clipped.startswith("HEAD"))
        self.assertTrue(clipped.endswith("FINAL-ANSWER"))
        self.assertIn(
            f"已省略中间 {len(payload) - dispatch.HEAD_CHARS - dispatch.TAIL_CHARS} 字符",
            clipped,
        )
        self.assertLessEqual(len(clipped), dispatch.MAX_OUTPUT_CHARS + 120)

    def test_short_output_is_returned_unchanged(self):
        buf = fill_buffer("short result")
        self.assertEqual(dispatch.clip(buf.head(), buf.tail, buf.total), "short result")

    def test_buffer_memory_is_bounded(self):
        buf = fill_buffer("x" * 4096 * 300)  # ~1.2 MB stdin stream
        self.assertLessEqual(len(buf.head()), dispatch.MAX_OUTPUT_CHARS)
        self.assertLessEqual(len(buf.tail), dispatch.TAIL_CHARS)
        self.assertEqual(buf.total, 4096 * 300)

    def test_stderr_short_text_is_rebuilt_without_duplication(self):
        buf = fill_buffer("warning: one\nREAL ERROR\n",
                          head_cap=dispatch.STDERR_HEAD_CHARS,
                          tail_cap=dispatch.STDERR_TAIL_CHARS)
        self.assertEqual(dispatch.format_stderr(buf), "warning: one\nREAL ERROR\n")

    def test_stderr_overlap_is_rebuilt_once(self):
        text = "w" * 5000  # head 4000 + tail 2000 overlap; must not duplicate
        buf = fill_buffer(text, head_cap=dispatch.STDERR_HEAD_CHARS,
                          tail_cap=dispatch.STDERR_TAIL_CHARS)
        self.assertEqual(dispatch.format_stderr(buf), text)

    def test_stderr_long_text_keeps_head_and_tail(self):
        text = "w" * 10_000 + "REAL ERROR: auth expired\n"
        buf = fill_buffer(text, head_cap=dispatch.STDERR_HEAD_CHARS,
                          tail_cap=dispatch.STDERR_TAIL_CHARS)
        rendered = dispatch.format_stderr(buf)
        self.assertIn("stderr 已省略", rendered)
        self.assertTrue(rendered.endswith("REAL ERROR: auth expired\n"))

    def test_error_detail_keeps_both_ends(self):
        text = "REAL ERROR: start" + "A" * 5_000 + "FINAL TAIL"
        detail = dispatch.error_detail(text)
        self.assertLessEqual(len(detail), dispatch.ERROR_DETAIL_CHARS + 4)
        self.assertIn("REAL ERROR: start", detail)
        self.assertIn("FINAL TAIL", detail)


class RunAgentTests(unittest.TestCase):
    def test_long_stdout_keeps_true_tail(self):
        code = "import sys\nsys.stdout.write('x' * 300000 + '\\nFINAL-ANSWER\\n')\n"
        exit_code, out_buf, _err_buf, timed_out = dispatch.run_agent(
            [sys.executable, "-c", code], os.getcwd()
        )
        self.assertEqual(exit_code, 0)
        self.assertFalse(timed_out)
        self.assertGreater(out_buf.total, 300_000)
        clipped = dispatch.clip(out_buf.head(), out_buf.tail, out_buf.total)
        self.assertTrue(clipped.endswith("FINAL-ANSWER"))
        self.assertIn("已省略中间", clipped)

    def test_non_utf8_bytes_are_replaced_not_fatal(self):
        code = "import sys\nsys.stdout.buffer.write(b'OK\\xff\\xfe\\n')\n"
        exit_code, out_buf, _err_buf, _timed_out = dispatch.run_agent(
            [sys.executable, "-c", code], os.getcwd()
        )
        self.assertEqual(exit_code, 0)
        self.assertIn("OK", out_buf.head())
        self.assertIn("\ufffd", out_buf.head())

    def test_timeout_reports_and_returns_quickly(self):
        code = "import time\ntime.sleep(30)\n"
        started = time.monotonic()
        _exit_code, _out_buf, _err_buf, timed_out = dispatch.run_agent(
            [sys.executable, "-c", code], os.getcwd(), timeout=0.3
        )
        self.assertTrue(timed_out)
        self.assertLess(time.monotonic() - started, 10)

    def test_stdin_is_closed_so_clis_do_not_hang(self):
        code = "import sys\ndata = sys.stdin.read()\nprint('stdin=' + repr(data))"
        exit_code, out_buf, _err_buf, _timed_out = dispatch.run_agent(
            [sys.executable, "-c", code], os.getcwd()
        )
        self.assertEqual(exit_code, 0)
        self.assertIn("stdin=''", out_buf.head())

    def test_exit_code_error_detail_keeps_trailing_stderr(self):
        code = (
            "import sys\n"
            "sys.stderr.write('warning\\n' * 2000 + 'REAL ERROR: auth expired\\n')\n"
            "sys.exit(3)\n"
        )
        exit_code, _out_buf, err_buf, timed_out = dispatch.run_agent(
            [sys.executable, "-c", code], os.getcwd()
        )
        self.assertEqual(exit_code, 3)
        self.assertFalse(timed_out)
        detail = dispatch.error_detail(dispatch.format_stderr(err_buf))
        self.assertIn("REAL ERROR: auth expired", detail)


class MainErrorDetailTests(unittest.TestCase):
    def test_whitespace_only_stderr_falls_back_to_stdout(self):
        out_buf = dispatch._OutputBuffer(dispatch.MAX_OUTPUT_CHARS, dispatch.TAIL_CHARS)
        out_buf.feed("REAL STDOUT ERROR: quota exhausted\n")
        err_buf = dispatch._OutputBuffer(dispatch.STDERR_HEAD_CHARS, dispatch.STDERR_TAIL_CHARS)
        err_buf.feed(" \n\t\n")
        with mock.patch.object(dispatch, "load_conf", return_value=None):
            with mock.patch.object(
                dispatch, "run_agent", return_value=(3, out_buf, err_buf, False)
            ):
                with mock.patch.object(sys, "argv", ["dispatch.py", "codex", "t"]):
                    with self.assertRaises(SystemExit) as raised:
                        dispatch.main()

        self.assertIn("REAL STDOUT ERROR: quota exhausted", str(raised.exception.code))


class DoctorTests(unittest.TestCase):
    def test_doctor_probes_the_resolved_path_with_utf8(self):
        calls = []

        def fake_run(argv, **kwargs):
            calls.append((argv, kwargs))
            return subprocess.CompletedProcess(argv, 0, stdout="v1\n", stderr="")

        with mock.patch.object(dispatch, "resolve_binary", return_value="/usr/bin/fake-codex"):
            with mock.patch.object(dispatch.subprocess, "run", side_effect=fake_run):
                with contextlib.redirect_stdout(io.StringIO()):
                    dispatch.doctor()

        probes = [call for call in calls if call[0][0] == "/usr/bin/fake-codex"]
        self.assertTrue(probes, "doctor must probe the resolved executable path")
        self.assertEqual(probes[0][0][1], "--version")
        self.assertEqual(probes[0][1].get("encoding"), "utf-8")
        self.assertEqual(probes[0][1].get("errors"), "replace")


if __name__ == "__main__":
    unittest.main()
