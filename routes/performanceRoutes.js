const express = require("express");
const router = express.Router();
const {
  getSystems,
  getSystemPerformance,
} = require("../controllers/performanceController");

router.get("/systems", getSystems);
router.get("/stats/:systemId", getSystemPerformance);

module.exports = router;

