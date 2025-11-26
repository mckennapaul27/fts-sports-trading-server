const express = require("express");
const router = express.Router();
const {
  getSystems,
  getSystem,
  createSystem,
  updateSystem,
  deleteSystem,
} = require("../controllers/systemController");

router.route("/").get(getSystems).post(createSystem);
router.route("/:id").get(getSystem).put(updateSystem).delete(deleteSystem);

module.exports = router;

