const express = require("express");
const router = express.Router();
const {
  getSystems,
  getSystemPerformance,
  getAllSystemsWithStats,
  getSystemResults,
  getMonthlyBreakdown,
  getSystemFilterOptions,
} = require("../controllers/performanceController");

router.get("/systems", getSystems);
router.get("/all-systems", getAllSystemsWithStats);
router.get("/stats/:systemId", getSystemPerformance);
router.get("/results/:systemId", getSystemResults);
router.get("/monthly/:systemId", getMonthlyBreakdown);
router.get("/filters/:systemId", getSystemFilterOptions);

module.exports = router;
