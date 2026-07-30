import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "_internal"))
sys.path.insert(0, str(ROOT))

from app.api.public import _public_status_summary  # noqa: E402


class PublicStatusTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
