const express = require("express");
const router = express.Router();
const {
  getSystemResults,
  getSystemResult,
  syncSystem,
  syncAll,
  deleteSystemResult,
} = require("../controllers/systemResultController");

router.route("/").get(getSystemResults);
router.route("/sync-all").post(syncAll);
router.route("/sync/:systemId").post(syncSystem);
router.route("/:id").get(getSystemResult).delete(deleteSystemResult);

module.exports = router;

