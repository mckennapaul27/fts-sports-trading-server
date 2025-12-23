const express = require("express");
const router = express.Router();
const {
  downloadAllCSV,
  downloadAllXLSX,
  downloadSystemCSV,
  downloadSystemXLSX,
} = require("../controllers/downloadController");

// All routes are public - results are available to everyone
// Complete Portfolio downloads (all systems, all dates)
router.route("/all/csv").get(downloadAllCSV);
router.route("/all/xlsx").get(downloadAllXLSX);

// Individual system/filtered downloads (by system, by date range)
router.route("/system/csv").get(downloadSystemCSV);
router.route("/system/xlsx").get(downloadSystemXLSX);

module.exports = router;
