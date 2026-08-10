const { AppError } = require("../errors");

class SmartFarmProvider {
  constructor() {
    this.provider = "smartfarm";
  }

  createTaskDraft() {
    throw notImplemented();
  }

  getTaskDraft() {
    throw notImplemented();
  }

  getCapabilities() {
    return {
      provider: this.provider,
      supportsTaskDrafts: false,
      transmitsToDji: false,
      executionAllowed: false,
      requiresOfficialDjiDocumentation: true
    };
  }
}

function notImplemented() {
  return new AppError(
    501,
    "SMARTFARM_ADAPTER_NOT_IMPLEMENTED",
    "DJI SmartFarm adapter is not implemented. Official DJI Smart Farm Ecosystem documentation is required before adding real calls."
  );
}

module.exports = {
  SmartFarmProvider
};
