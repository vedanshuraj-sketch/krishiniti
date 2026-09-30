/**
 * Crop Usage Discovery Routes
 *
 * Crop -> Plant Part -> Industry -> Product -> Buyer Type -> Processing
 *
 * Backed by krishiniti_crop_valuechain_final.csv. This is a static
 * knowledge base of value channels, NOT demand data, and every response
 * says so.
 */
const express = require('express');
const valueChain = require('../services/valueChain');

const router = express.Router();

router.get('/status', (req, res) => res.json(valueChain.status()));

router.get('/crops', (req, res) => {
  const status = valueChain.status();
  res.json({
    label: valueChain.LABEL,
    is_live_demand: false,
    source: status.source_file,
    crop_count: status.crop_count,
    crops: valueChain.listCrops(),
  });
});

router.get('/:crop', (req, res) => {
  res.json(valueChain.discover(req.params.crop));
});

module.exports = router;
