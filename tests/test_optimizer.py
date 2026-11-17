import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ENGINE = Path(__file__).resolve().parents[1] / "engine"
sys.path.insert(0, str(ENGINE.parent))
from engine import optimizer  # noqa: E402


@unittest.skipUnless(importlib.util.find_spec("ortools"), "OR-Tools optional dependency not installed")
class OptimizerTests(unittest.TestCase):
    def test_feasible_and_independently_validated(self):
        rows = [{"slot": "08:00-09:00", "flow": 100}, {"slot": "09:00-10:00", "flow": 200}]
        result = optimizer.optimize(rows, 10, 100, safety=0.15)
        self.assertEqual(result["status"], "feasible")
        self.assertEqual(optimizer.validate_solution(rows, [r["veh"] for r in result["rows"]], 10, 100, .15, {}), [])

    def test_locked_slots_are_preserved(self):
        rows = [{"slot": "08", "flow": 100}, {"slot": "09", "flow": 100}]
        result = optimizer.optimize(rows, 5, 100, locked={"08": 2}, safety=.1)
        self.assertEqual(result["status"], "feasible")
        self.assertEqual(result["rows"][0]["veh"], 2)

    def test_fleet_shortage_is_explicit(self):
        rows = [{"slot": "08", "flow": 500}]
        result = optimizer.optimize(rows, 1, 100, safety=.15)
        self.assertEqual(result["status"], "infeasible")
        self.assertFalse(result["rows"])

    def test_missing_dependency_fallback(self):
        rows = [{"slot": "08", "flow": 100}]
        with patch.dict(sys.modules, {"ortools": None, "ortools.sat": None, "ortools.sat.python": None}):
            result = optimizer.optimize(rows, 5, 100)
        self.assertEqual(result["status"], "unavailable")

    def test_assumptions_are_exposed(self):
        result = optimizer.optimize([{"slot": "08", "flow": 100, "assumed": True}], 5, 100,
                                   force_status="unavailable")
        self.assertTrue(any("假设" in x for x in result["assumptions"]))


if __name__ == "__main__":
    unittest.main()
