/**
 * Quality Assessment
 * ==================
 *
 * One place that decides what a crop lot's quality evidence actually
 * proves, and the exact wording the UI is allowed to show for it.
 *
 * Hard rules encoded here:
 *
 *  - A certificate is NOT required to create a crop lot.
 *  - No method in this build produces a verified or laboratory grade.
 *    `verified` exists in the schema for a future verification workflow
 *    that does not exist yet, and nothing in this codebase can set it.
 *  - Camera output is never described as a certified grade. Without a
 *    computer-vision model it is described only as photos for buyer review.
 *  - `is_certified` (which unlocks certified-buyer pricing in the optimizer
 *    and removes the quality penalty) is true ONLY for a genuinely verified
 *    certificate. Uploading a file does not move that flag.
 *
 * VISUAL_MODEL_ENABLED is false because no computer-vision model is
 * implemented. Flipping it on without shipping a model would make the app
 * claim an assessment it never performed.
 */

const VISUAL_MODEL_ENABLED = false;

const QUALITY_METHODS = {
  certificate_upload: {
    key: 'certificate_upload',
    display_name: 'Certificate upload',
    description: 'Attach a quality certificate document.',
    claim_strength: 'unverified_document',
    requires_photos: false,
  },
  self_declared: {
    key: 'self_declared',
    display_name: 'Self-declared',
    description: 'Describe the quality yourself. No document needed.',
    claim_strength: 'self_declared',
    requires_photos: false,
  },
  camera_assisted: {
    key: 'camera_assisted',
    display_name: 'Camera-assisted',
    description: 'Take photos of the produce for buyers to review.',
    claim_strength: VISUAL_MODEL_ENABLED ? 'provisional_visual' : 'photos_only',
    requires_photos: true,
  },
};

const DEFAULT_METHOD = 'self_declared';

/** Buyer-side quality requirements, weakest to strictest. */
const QUALITY_REQUIREMENTS = {
  self_declared: {
    key: 'self_declared',
    rank: 0,
    display_name: 'Self-declared accepted',
  },
  photo_review: {
    key: 'photo_review',
    rank: 1,
    display_name: 'Photo review accepted',
  },
  certificate_required: {
    key: 'certificate_required',
    rank: 2,
    display_name: 'Certificate required',
  },
};

function normaliseMethod(method) {
  const key = String(method || '').trim();
  return QUALITY_METHODS[key] ? key : DEFAULT_METHOD;
}

function normaliseRequirement(requirement) {
  const key = String(requirement || '').trim();
  return QUALITY_REQUIREMENTS[key] ? key : 'self_declared';
}

/**
 * The claim a lot's quality evidence supports, plus the exact label text.
 *
 * Returns:
 *   { method, certificate_status, is_certified, evidence_rank,
 *     label, sub_label, claim_strength, warnings }
 *
 * `evidence_rank` is compared against a buyer's requirement rank:
 *   0 = self-declaration only
 *   1 = photos available for review
 *   2 = a certificate document exists (still unverified)
 *   3 = a verified certificate (unreachable in this build)
 */
function describeLotQuality(lot) {
  const method = normaliseMethod(lot.quality_method);
  const certificateStatus = lot.certificate_status || 'not_uploaded';
  const photoCount = Number(lot.quality_photo_count || 0);
  const warnings = [];

  let label;
  let subLabel;
  let evidenceRank = 0;
  let isCertified = false;

  if (method === 'certificate_upload') {
    if (certificateStatus === 'verified') {
      // Not reachable in this build; no verification workflow exists.
      label = 'Certificate verified';
      subLabel = 'Checked by a verifying authority.';
      evidenceRank = 3;
      isCertified = true;
    } else if (certificateStatus === 'uploaded_unverified') {
      label = 'Certificate uploaded — verification pending';
      subLabel =
        'Only the document details were recorded. Nobody has checked this ' +
        'certificate, and the app does not treat it as verified.';
      evidenceRank = 2;
      warnings.push(
        'Certificate verification is not implemented. Buyers who require a ' +
          'certificate will see this lot as needing verification first.'
      );
    } else {
      label = 'Certificate not uploaded';
      subLabel = 'You chose certificate upload but no document was attached.';
      evidenceRank = 0;
      warnings.push(
        'No certificate document was attached, so this lot counts as ' +
          'self-declared for buyer matching.'
      );
    }
  } else if (method === 'camera_assisted') {
    if (photoCount > 0 && VISUAL_MODEL_ENABLED && lot.visual_assessment) {
      label = 'App-assisted visual assessment — provisional, buyer verification required';
      subLabel =
        'A visual scoring heuristic produced a provisional read. It is not a ' +
        'certified or laboratory grade.';
      evidenceRank = 1;
    } else if (photoCount > 0) {
      label = 'Photos captured for buyer review — not a verified quality grade';
      subLabel =
        'No automated grading was performed on these photos. Buyers review ' +
        'them themselves.';
      evidenceRank = 1;
    } else {
      label = 'No photos captured';
      subLabel = 'You chose camera-assisted but no photos were attached.';
      evidenceRank = 0;
      warnings.push(
        'No photos were attached, so this lot counts as self-declared for ' +
          'buyer matching.'
      );
    }
  } else {
    label = 'Farmer self-declared quality';
    subLabel =
      'Based on what you entered. No document, photo or inspection backs it up.';
    evidenceRank = 0;
  }

  return {
    method,
    method_display_name: QUALITY_METHODS[method].display_name,
    certificate_status: certificateStatus,
    is_certified: isCertified,
    evidence_rank: evidenceRank,
    photo_count: photoCount,
    declared_grade: lot.grade || null,
    quality_notes: lot.quality_notes || null,
    moisture_percent: lot.moisture_percent == null ? null : Number(lot.moisture_percent),
    size_description: lot.size_description || null,
    appearance_description: lot.appearance_description || null,
    label,
    sub_label: subLabel,
    claim_strength: QUALITY_METHODS[method].claim_strength,
    visual_model_enabled: VISUAL_MODEL_ENABLED,
    warnings,
  };
}

/**
 * Can this lot's quality evidence satisfy this buyer?
 *
 * A certificate-required buyer is never "fully eligible" for a
 * self-declared or camera-assisted lot — the best it can be is
 * conditional, and the reason always says what is missing.
 *
 * Returns { compatible, conditional, score_fraction, reason }.
 */
function checkQualityCompatibility(quality, buyerRequirement) {
  const requirement = normaliseRequirement(buyerRequirement);
  const req = QUALITY_REQUIREMENTS[requirement];

  if (requirement === 'certificate_required') {
    if (quality.evidence_rank >= 3) {
      return {
        compatible: true,
        conditional: false,
        score_fraction: 1,
        requirement,
        requirement_display: req.display_name,
        reason: 'Buyer requires a certificate and this lot has a verified one.',
      };
    }
    if (quality.evidence_rank === 2) {
      return {
        compatible: true,
        conditional: true,
        score_fraction: 0.5,
        requirement,
        requirement_display: req.display_name,
        reason:
          'Buyer requires a certificate. This lot has one uploaded but not ' +
          'verified, so the buyer would need to verify it before proceeding.',
      };
    }
    return {
      compatible: false,
      conditional: false,
      score_fraction: 0,
      requirement,
      requirement_display: req.display_name,
      reason:
        `Buyer requires a certificate. This lot is ${
          quality.method === 'camera_assisted' ? 'camera-assisted' : 'self-declared'
        }, so it does not meet that requirement.`,
    };
  }

  if (requirement === 'photo_review') {
    if (quality.evidence_rank >= 1) {
      return {
        compatible: true,
        conditional: false,
        score_fraction: 1,
        requirement,
        requirement_display: req.display_name,
        reason:
          quality.evidence_rank >= 2
            ? 'Buyer accepts photo review; this lot has a certificate document on file.'
            : 'Buyer accepts photo review and this lot has photos attached.',
      };
    }
    return {
      compatible: true,
      conditional: true,
      score_fraction: 0.4,
      requirement,
      requirement_display: req.display_name,
      reason:
        'Buyer wants photos to review. This lot is self-declared with no ' +
        'photos, so add photos to strengthen the match.',
    };
  }

  return {
    compatible: true,
    conditional: false,
    score_fraction: 1,
    requirement,
    requirement_display: req.display_name,
    reason: 'Buyer accepts self-declared quality.',
  };
}

/**
 * Normalise the quality fields submitted with a crop lot.
 *
 * Never returns `certificate_status: 'verified'` — no input can set it.
 */
function normaliseQualityInput(body) {
  const method = normaliseMethod(body.quality_method);

  let certificateStatus = 'not_uploaded';
  let filename = null;
  let mimeType = null;
  let sizeBytes = null;
  let uploadedAt = null;

  if (method === 'certificate_upload' && body.certificate) {
    const cert = body.certificate;
    if (cert.filename || cert.name) {
      certificateStatus = 'uploaded_unverified';
      filename = String(cert.filename || cert.name).slice(0, 255);
      mimeType = cert.mime_type ? String(cert.mime_type).slice(0, 100) : null;
      sizeBytes = Number.isFinite(Number(cert.size_bytes))
        ? Math.round(Number(cert.size_bytes))
        : null;
      uploadedAt = new Date();
    }
  }

  const photos = Array.isArray(body.quality_photos)
    ? body.quality_photos
        .slice(0, 6)
        .map((p, i) => ({
          index: i,
          filename: p && (p.filename || p.name) ? String(p.filename || p.name).slice(0, 255) : null,
          mime_type: p && p.mime_type ? String(p.mime_type).slice(0, 100) : null,
          captured_at: new Date().toISOString(),
          // No image bytes are stored. Metadata only, same as certificates.
          stored: false,
        }))
    : [];

  const moisture = Number(body.moisture_percent);

  return {
    quality_method: method,
    certificate_status: certificateStatus,
    certificate_filename: filename,
    certificate_mime_type: mimeType,
    certificate_size_bytes: sizeBytes,
    certificate_uploaded_at: uploadedAt,
    quality_notes: body.quality_notes ? String(body.quality_notes).slice(0, 2000) : null,
    moisture_percent:
      Number.isFinite(moisture) && moisture >= 0 && moisture <= 100 ? moisture : null,
    size_description: body.size_description ? String(body.size_description).slice(0, 120) : null,
    appearance_description: body.appearance_description
      ? String(body.appearance_description).slice(0, 120)
      : null,
    quality_photo_count: method === 'camera_assisted' ? photos.length : 0,
    quality_photos: method === 'camera_assisted' && photos.length ? JSON.stringify(photos) : null,
    // Only populated by a real model. None exists, so always null.
    visual_assessment: null,
  };
}

module.exports = {
  VISUAL_MODEL_ENABLED,
  QUALITY_METHODS,
  QUALITY_REQUIREMENTS,
  DEFAULT_METHOD,
  normaliseMethod,
  normaliseRequirement,
  describeLotQuality,
  checkQualityCompatibility,
  normaliseQualityInput,
};
