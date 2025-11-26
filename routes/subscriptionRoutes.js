const express = require("express");
const router = express.Router();
const {
  getSubscriptions,
  getSubscription,
  getSubscriptionsByUser,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} = require("../controllers/subscriptionController");

router.route("/").get(getSubscriptions).post(createSubscription);
router.route("/user/:userId").get(getSubscriptionsByUser);
router
  .route("/:id")
  .get(getSubscription)
  .put(updateSubscription)
  .delete(deleteSubscription);

module.exports = router;

