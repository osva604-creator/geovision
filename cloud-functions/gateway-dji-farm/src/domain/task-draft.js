const { AppError } = require("../errors");

const SCHEMA_VERSION = "geovision.agras.taskDraft.v1";
const CRS = "EPSG:4326";
const ALLOWED_TOP_LEVEL = new Set([
  "schemaVersion",
  "externalId",
  "name",
  "operationType",
  "fieldBoundary",
  "exclusionZones",
  "desiredParameters",
  "createdAt",
  "coordinateReferenceSystem"
]);
const ALLOWED_PARAMETERS = new Set([
  "operatorApproved",
  "applicationRate",
  "flightAltitudeMeters",
  "swathWidthMeters",
  "notes"
]);

function normalizeTaskDraft(input, now = new Date()) {
  assertObject(input, "draft");
  rejectUnexpectedKeys(input, ALLOWED_TOP_LEVEL, "draft");

  const draft = {
    schemaVersion: requireString(input.schemaVersion, "schemaVersion", 64),
    externalId: requireString(input.externalId, "externalId", 128),
    name: requireString(input.name, "name", 120),
    operationType: requireEnum(input.operationType, "operationType", ["spray", "spread"]),
    fieldBoundary: normalizePolygon(input.fieldBoundary, "fieldBoundary"),
    exclusionZones: normalizeExclusionZones(input.exclusionZones),
    desiredParameters: normalizeDesiredParameters(input.desiredParameters),
    createdAt: normalizeCreatedAt(input.createdAt, now),
    coordinateReferenceSystem: input.coordinateReferenceSystem || CRS
  };

  if (draft.schemaVersion !== SCHEMA_VERSION) {
    throw validationError("schemaVersion", `schemaVersion must be ${SCHEMA_VERSION}.`);
  }
  if (draft.coordinateReferenceSystem !== CRS) {
    throw validationError("coordinateReferenceSystem", `coordinateReferenceSystem must be ${CRS}.`);
  }

  return draft;
}

function normalizeDesiredParameters(raw) {
  assertObject(raw, "desiredParameters");
  rejectUnexpectedKeys(raw, ALLOWED_PARAMETERS, "desiredParameters");
  if (raw.operatorApproved !== false) {
    throw validationError(
      "desiredParameters.operatorApproved",
      "desiredParameters.operatorApproved must be false because these values are not operator-approved."
    );
  }

  const normalized = { operatorApproved: false };
  for (const field of ["applicationRate", "flightAltitudeMeters", "swathWidthMeters"]) {
    if (raw[field] !== undefined) {
      normalized[field] = requirePositiveFiniteNumber(raw[field], `desiredParameters.${field}`);
    }
  }
  if (raw.notes !== undefined) {
    normalized.notes = requireString(raw.notes, "desiredParameters.notes", 500, true);
  }
  return normalized;
}

function normalizeExclusionZones(raw) {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw validationError("exclusionZones", "exclusionZones must be an array of GeoJSON Polygons.");
  }
  if (raw.length > 20) {
    throw validationError("exclusionZones", "exclusionZones cannot contain more than 20 polygons.");
  }
  return raw.map((polygon, index) => normalizePolygon(polygon, `exclusionZones[${index}]`));
}

function normalizePolygon(raw, path) {
  assertObject(raw, path);
  rejectUnexpectedKeys(raw, new Set(["type", "coordinates"]), path);
  if (raw.type !== "Polygon") {
    throw validationError(path, `${path}.type must be Polygon.`);
  }
  if (!Array.isArray(raw.coordinates)) {
    throw validationError(`${path}.coordinates`, `${path}.coordinates must be an array of rings.`);
  }
  if (raw.coordinates.length === 0) {
    throw validationError(`${path}.coordinates`, `${path}.coordinates must include at least one ring.`);
  }
  if (raw.coordinates.length > 10) {
    throw validationError(`${path}.coordinates`, `${path}.coordinates cannot include more than 10 rings.`);
  }

  return {
    type: "Polygon",
    coordinates: raw.coordinates.map((ring, index) => normalizeRing(ring, `${path}.coordinates[${index}]`))
  };
}

function normalizeRing(raw, path) {
  if (!Array.isArray(raw)) {
    throw validationError(path, `${path} must be an array of coordinates.`);
  }
  if (raw.length < 4) {
    throw validationError(path, `${path} must contain at least 4 positions.`);
  }
  if (raw.length > 5000) {
    throw validationError(path, `${path} cannot contain more than 5000 positions.`);
  }

  const ring = raw.map((position, index) => normalizePosition(position, `${path}[${index}]`));
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    throw validationError(path, `${path} must be closed; first and last position must match.`);
  }
  return ring;
}

function normalizePosition(raw, path) {
  if (!Array.isArray(raw) || raw.length < 2) {
    throw validationError(path, `${path} must be a [longitude, latitude] position.`);
  }
  if (raw.length > 2) {
    throw validationError(path, `${path} must not include altitude or extra ordinates.`);
  }

  const lng = requireFiniteNumber(raw[0], `${path}[0]`);
  const lat = requireFiniteNumber(raw[1], `${path}[1]`);
  if (lng < -180 || lng > 180) {
    throw validationError(`${path}[0]`, "Longitude must be between -180 and 180.");
  }
  if (lat < -90 || lat > 90) {
    throw validationError(`${path}[1]`, "Latitude must be between -90 and 90.");
  }
  return [lng, lat];
}

function normalizeCreatedAt(raw, now) {
  const value = raw === undefined ? now.toISOString() : requireString(raw, "createdAt", 64);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw validationError("createdAt", "createdAt must be a valid ISO date.");
  }
  return new Date(timestamp).toISOString();
}

function assertObject(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw validationError(path, `${path} must be an object.`);
  }
}

function rejectUnexpectedKeys(value, allowed, path) {
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (unexpected.length > 0) {
    throw validationError(path, `${path} contains unexpected properties: ${unexpected.join(", ")}.`);
  }
}

function requireString(value, path, maxLength, allowEmpty = false) {
  if (typeof value !== "string") {
    throw validationError(path, `${path} must be a string.`);
  }
  const trimmed = value.trim();
  if (!allowEmpty && !trimmed) {
    throw validationError(path, `${path} cannot be empty.`);
  }
  if (trimmed.length > maxLength) {
    throw validationError(path, `${path} cannot exceed ${maxLength} characters.`);
  }
  return trimmed;
}

function requireEnum(value, path, allowed) {
  if (!allowed.includes(value)) {
    throw validationError(path, `${path} must be one of: ${allowed.join(", ")}.`);
  }
  return value;
}

function requireFiniteNumber(value, path) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw validationError(path, `${path} must be a finite number.`);
  }
  return number;
}

function requirePositiveFiniteNumber(value, path) {
  const number = requireFiniteNumber(value, path);
  if (number <= 0) {
    throw validationError(path, `${path} must be positive.`);
  }
  return number;
}

function validationError(field, message) {
  return new AppError(400, "VALIDATION_ERROR", message, { field });
}

module.exports = {
  SCHEMA_VERSION,
  CRS,
  normalizeTaskDraft
};
