import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_internal"))
sys.path.insert(0, str(ROOT))

from app.api import public as public_api  # noqa: E402
from app.api.public import _probe_icecast_origin, _public_status_summary  # noqa: E402


class _ProbeResponse:
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class PublicStatusTests(unittest.TestCase):
    def setUp(self):
        public_api._origin_probe_cache.clear()

    def test_required_output_degradation_is_not_reported_live(self):
        status, reason = _public_status_summary(
            {
                "running": True,
                "branch_health": {
                    "icecast": False,
                    "local": True,
                    "icecast:/backup": False,
                },
                "required_outputs": {
                    "icecast": True,
                    "local": True,
                    "icecast:/backup": True,
                },
            },
            {"running": True, "last_error": ""},
        )

        self.assertEqual(status, "degraded")
        self.assertEqual(reason, "Runtime is running but required outputs are degraded")

    def test_all_required_outputs_healthy_is_live(self):
        status, reason = _public_status_summary(
            {
                "running": True,
                "branch_health": {"icecast": True, "local": True},
                "required_outputs": {"icecast": True, "local": True},
            },
            {"running": True, "last_error": ""},
        )

        self.assertEqual(status, "live")
        self.assertEqual(reason, "Runtime healthy")

    def test_unreachable_icecast_origin_is_not_reported_live(self):
        status, reason = _public_status_summary(
            {
                "running": True,
                "branch_health": {"icecast": True},
                "required_outputs": {"icecast": True},
            },
            {"running": True, "last_error": ""},
            icecast_origin_confirmed=False,
        )

        self.assertEqual(status, "degraded")
        self.assertEqual(
            reason,
            "Runtime is running but the Icecast mount is not reachable",
        )

    @patch("app.api.public.urlopen")
    def test_icecast_origin_probe_uses_short_lived_cache(self, urlopen):
        urlopen.return_value = _ProbeResponse()
        output = {
            "icecast_enabled": True,
            "icecast_host": "127.0.0.1",
            "icecast_port": 8000,
            "icecast_mount": "/lofi",
        }

        with patch("app.api.public.time.monotonic", return_value=10.0):
            self.assertTrue(_probe_icecast_origin(2, output, {}))
        with patch("app.api.public.time.monotonic", return_value=12.0):
            self.assertTrue(_probe_icecast_origin(2, output, {}))

        self.assertEqual(urlopen.call_count, 1)

    @patch("app.api.public.urlopen")
    def test_icecast_origin_probe_requires_two_consecutive_failures(self, urlopen):
        output = {
            "icecast_enabled": True,
            "icecast_host": "127.0.0.1",
            "icecast_port": 8000,
            "icecast_mount": "/lofi",
        }
        urlopen.side_effect = [_ProbeResponse(), OSError("reset"), OSError("reset")]

        with patch("app.api.public.time.monotonic", return_value=10.0):
            self.assertTrue(_probe_icecast_origin(2, output, {}))
        with patch("app.api.public.time.monotonic", return_value=16.0):
            self.assertTrue(_probe_icecast_origin(2, output, {}))
        with patch("app.api.public.time.monotonic", return_value=22.0):
            self.assertFalse(_probe_icecast_origin(2, output, {}))


if __name__ == "__main__":
    unittest.main()
