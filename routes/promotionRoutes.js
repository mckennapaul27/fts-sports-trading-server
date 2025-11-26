const express = require("express");
const router = express.Router();
const {
  getPromotions,
  getPromotion,
  getPromotionByCode,
  createPromotion,
  updatePromotion,
  deletePromotion,
} = require("../controllers/promotionController");

router.route("/").get(getPromotions).post(createPromotion);
router.route("/code/:code").get(getPromotionByCode);
router
  .route("/:id")
  .get(getPromotion)
  .put(updatePromotion)
  .delete(deletePromotion);

module.exports = router;

