const test = require("node:test");
const assert = require("node:assert/strict");
const camera = require("../js/camera-projection");

function approx(actual, expected, tolerance = 0.2) {
    assert.ok(
        Math.abs(actual - expected) <= tolerance,
        `expected ${actual} to be within ${tolerance} of ${expected}`
    );
}

const baseProjection = {
    pixelX: 500,
    pixelY: 500,
    imageWidth: 1000,
    imageHeight: 1000,
    latitude: -26.837,
    longitude: -65.203,
    heightM: 100,
    yawDeg: 0,
    depressionDeg: 45,
    horizontalFovDeg: 30,
    verticalFovDeg: 30
};

test("center at 100m height and 45deg downward lands about 100m away", () => {
    const result = camera.projectPixelToGround(baseProjection);
    assert.equal(result.valid, true);
    approx(result.distanceM, 100);
});

test("pixel 15deg below center lands about 57.7m away", () => {
    const result = camera.projectPixelToGround({
        ...baseProjection,
        pixelY: 1000
    });
    assert.equal(result.valid, true);
    approx(result.distanceM, 57.7);
});

test("pixel 15deg above center lands about 173.2m away", () => {
    const result = camera.projectPixelToGround({
        ...baseProjection,
        pixelY: 0
    });
    assert.equal(result.valid, true);
    approx(result.distanceM, 173.2);
});

test("DJI GimbalPitchDegree -45 becomes 45deg downward", () => {
    const result = camera.resolveCameraPitch({
        metadata: { GimbalPitchDegree: "-45.00" }
    });
    assert.equal(result.valid, true);
    assert.equal(result.source, "dji");
    assert.equal(result.depressionDeg, 45);
});

test("DJI GimbalPitchDegree 0 is recognized as a valid value", () => {
    const result = camera.resolveCameraPitch({
        metadata: { "drone-dji:GimbalPitchDegree": 0 }
    });
    assert.equal(result.valid, true);
    assert.equal(result.source, "dji");
    assert.equal(result.depressionDeg, 0);
});

test("missing pitch falls back to 25deg and is marked estimated", () => {
    const result = camera.resolveCameraPitch({ metadata: {} });
    assert.equal(result.valid, true);
    assert.equal(result.source, "estimated");
    assert.equal(result.estimated, true);
    assert.equal(result.depressionDeg, 25);
});

test("manual value has priority only when manual mode is active", () => {
    const manual = camera.resolveCameraPitch({
        manualEnabled: true,
        manualValue: 60,
        metadata: { GimbalPitchDegree: -45 }
    });
    assert.equal(manual.valid, true);
    assert.equal(manual.source, "manual");
    assert.equal(manual.depressionDeg, 60);

    const dji = camera.resolveCameraPitch({
        manualEnabled: false,
        manualValue: 60,
        metadata: { GimbalPitchDegree: -45 }
    });
    assert.equal(dji.source, "dji");
    assert.equal(dji.depressionDeg, 45);
});

test("CSS/displayed image size does not change projection", () => {
    const natural = camera.projectPixelToGround(baseProjection);
    const withCssSize = camera.projectPixelToGround({
        ...baseProjection,
        cssWidth: 250,
        cssHeight: 250
    });
    assert.equal(natural.valid, true);
    assert.equal(withCssSize.valid, true);
    approx(withCssSize.distanceM, natural.distanceM, 0.0001);
    approx(withCssSize.lat, natural.lat, 0.0000001);
    approx(withCssSize.lon, natural.lon, 0.0000001);
});
