const crypto = require("crypto");
const { AppError } = require("../errors");

class SmartFarmMockProvider {
  constructor() {
    this.provider = "smartfarm-mock";
    this.store = new Map();
  }

  createTaskDraft(draft) {
    const id = buildDeterministicId(draft);
    const result = {
      id,
      status: "DRAFT_NOT_SENT",
      provider: this.provider,
      transmittedToDji: false,
      executionAllowed: false,
      warning: "Mock mode only. No information was sent to DJI and this is not an executable mission.",
      draft
    };
    this.store.set(id, result);
    return result;
  }

  getTaskDraft(id) {
    const draft = this.store.get(id);
    if (!draft) {
      throw new AppError(404, "TASK_DRAFT_NOT_FOUND", "Task draft was not found.");
    }
    return draft;
  }

  getCapabilities() {
    return {
      provider: this.provider,
      inMemoryOnly: true,
      supportsTaskDrafts: true,
      transmitsToDji: false,
      executionAllowed: false
    };
  }
}

function buildDeterministicId(draft) {
  const hashInput = JSON.stringify({
    schemaVersion: draft.schemaVersion,
    externalId: draft.externalId,
    name: draft.name,
    operationType: draft.operationType,
    fieldBoundary: draft.fieldBoundary,
    exclusionZones: draft.exclusionZones,
    desiredParameters: draft.desiredParameters,
    coordinateReferenceSystem: draft.coordinateReferenceSystem
  });
  const hash = crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 24);
  return `draft_${hash}`;
}

module.exports = {
  SmartFarmMockProvider,
  buildDeterministicId
};
