import contextlib
import importlib.util
import io
import sys
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
        self.assertIn("inspect only", rendered)
        self.assertIn("no shell is used", rendered)

    def test_main_dry_run_does_not_spawn_subprocess(self):
        output = io.StringIO()
        argv = ["dispatch.py", "--dry-run", "codex", "preview this task"]
        with mock.patch.object(sys, "argv", argv):
            with mock.patch.object(dispatch, "resolve_binary", return_value="/usr/bin/fake-codex"):
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


if __name__ == "__main__":
    unittest.main()
