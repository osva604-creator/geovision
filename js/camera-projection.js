(function (root, factory) {
    if (typeof module !== "undefined" && module.exports) {
        module.exports = factory();
    } else {
        root.GeoVisionCamera = factory();
    }
}(typeof self !== "undefined" ? self : this, function () {
    "use strict";

    const EARTH_RADIUS_M = 6371000;
    const DEFAULT_DEPRESSION_DEG = 25;
    const MIN_INTERSECTION_DEPRESSION_DEG = 1;
    const MAX_REASONABLE_GROUND_DISTANCE_M = 10000;
    const DJI_PITCH_KEYS = [
        "GimbalPitchDegree",
        "drone-dji:GimbalPitchDegree",
        "XMP-drone-dji:GimbalPitchDegree"
    ];

    function degToRad(deg) {
        return (deg * Math.PI) / 180;
    }

    function radToDeg(rad) {
        return (rad * 180) / Math.PI;
    }

    function toFiniteNumber(value) {
        if (typeof value === "number") return Number.isFinite(value) ? value : null;
        if (typeof value === "string") {
            const normalized = value.trim().replace(",", ".");
            if (!normalized) return null;
            const parsed = Number(normalized);
            return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
    }

    function normalizeKey(value) {
        return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function normalizeDjiGimbalPitchToDepression(value) {
        const pitch = toFiniteNumber(value);
        if (!Number.isFinite(pitch) || pitch < -90 || pitch > 90) return null;
        return Math.abs(pitch);
    }

    function normalizeManualDepression(value) {
        const depression = toFiniteNumber(value);
        if (!Number.isFinite(depression) || depression < 0 || depression > 90) return null;
        return depression;
    }

    function findDjiGimbalPitch(metadata) {
        if (!metadata || typeof metadata !== "object") return null;
        const targets = DJI_PITCH_KEYS.map(normalizeKey);
        const stack = [{ value: metadata, path: "" }];

        while (stack.length > 0) {
            const current = stack.pop();
            if (!current.value || typeof current.value !== "object") continue;

            for (const [key, value] of Object.entries(current.value)) {
                const path = current.path ? `${current.path}.${key}` : key;
                const keyNormalized = normalizeKey(key);
                const pathNormalized = normalizeKey(path);
                const matched = targets.some((target) => keyNormalized === target || pathNormalized.endsWith(target));
                if (matched) {
                    const depressionDeg = normalizeDjiGimbalPitchToDepression(value);
                    if (depressionDeg !== null) {
                        return {
                            field: path,
                            rawPitchDeg: toFiniteNumber(value),
                            depressionDeg
                        };
                    }
                }
                if (value && typeof value === "object") stack.push({ value, path });
            }
        }

        return null;
    }

    function resolveCameraPitch(options = {}) {
        const defaultDepressionDeg = normalizeManualDepression(options.defaultDepressionDeg) ?? DEFAULT_DEPRESSION_DEG;

        if (options.manualEnabled === true) {
            const manualDepression = normalizeManualDepression(options.manualValue);
            if (manualDepression === null) {
                return {
                    valid: false,
                    reason: "invalid_manual_pitch",
                    source: "manual",
                    label: "Manual",
                    estimated: false,
                    depressionDeg: null,
                    confirmed: false
                };
            }
            return {
                valid: true,
                source: "manual",
                label: "Manual",
                estimated: false,
                depressionDeg: manualDepression,
                rawPitchDeg: null,
                field: null,
                confirmed: true
            };
        }

        const djiPitch = findDjiGimbalPitch(options.metadata);
        if (djiPitch) {
            return {
                valid: true,
                source: "dji",
                label: "DJI",
                estimated: false,
                depressionDeg: djiPitch.depressionDeg,
                rawPitchDeg: djiPitch.rawPitchDeg,
                field: djiPitch.field,
                confirmed: true
            };
        }

        return {
            valid: true,
            source: "estimated",
            label: "Estimado",
            estimated: true,
            depressionDeg: defaultDepressionDeg,
            rawPitchDeg: null,
            field: null,
            confirmed: false
        };
    }

    function normalizarGrados(deg) {
        const value = toFiniteNumber(deg);
        if (!Number.isFinite(value)) return null;
        return ((value % 360) + 360) % 360;
    }

    function estimateVerticalFov(horizontalFovDeg, imageWidth, imageHeight) {
        const hfov = toFiniteNumber(horizontalFovDeg);
        const width = toFiniteNumber(imageWidth);
        const height = toFiniteNumber(imageHeight);
        if (!Number.isFinite(hfov) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
        if (hfov <= 0 || hfov >= 180 || width <= 0 || height <= 0) return null;
        return radToDeg(2 * Math.atan(Math.tan(degToRad(hfov) / 2) * (height / width)));
    }

    function projectLatLon(latitude, longitude, distanceM, bearingDeg) {
        const latRad = degToRad(latitude);
        const lonRad = degToRad(longitude);
        const bearingRad = degToRad(bearingDeg);
        const angularDistance = distanceM / EARTH_RADIUS_M;

        const projectedLat = Math.asin(
            Math.sin(latRad) * Math.cos(angularDistance) +
            Math.cos(latRad) * Math.sin(angularDistance) * Math.cos(bearingRad)
        );
        const projectedLon = lonRad + Math.atan2(
            Math.sin(bearingRad) * Math.sin(angularDistance) * Math.cos(latRad),
            Math.cos(angularDistance) - Math.sin(latRad) * Math.sin(projectedLat)
        );

        return {
            lat: radToDeg(projectedLat),
            lon: radToDeg(projectedLon)
        };
    }

    function invalidProjection(reason, details = {}) {
        return {
            valid: false,
            reason,
            ...details
        };
    }

    function projectPixelToGround(options = {}) {
        const pixelX = toFiniteNumber(options.pixelX);
        const pixelY = toFiniteNumber(options.pixelY);
        const imageWidth = toFiniteNumber(options.imageWidth);
        const imageHeight = toFiniteNumber(options.imageHeight);
        const latitude = toFiniteNumber(options.latitude);
        const longitude = toFiniteNumber(options.longitude);
        const heightM = toFiniteNumber(options.heightM);
        const yawDeg = normalizarGrados(options.yawDeg);
        const depressionDeg = normalizeManualDepression(options.depressionDeg);
        const horizontalFovDeg = toFiniteNumber(options.horizontalFovDeg);
        const verticalFovDeg = toFiniteNumber(options.verticalFovDeg) ||
            estimateVerticalFov(horizontalFovDeg, imageWidth, imageHeight);
        const maxDistanceM = toFiniteNumber(options.maxDistanceM) || MAX_REASONABLE_GROUND_DISTANCE_M;
        const minDepressionDeg = toFiniteNumber(options.minDepressionDeg) || MIN_INTERSECTION_DEPRESSION_DEG;

        if (![pixelX, pixelY, imageWidth, imageHeight, latitude, longitude, heightM, yawDeg, depressionDeg, horizontalFovDeg, verticalFovDeg].every(Number.isFinite)) {
            return invalidProjection("invalid_input");
        }
        if (imageWidth <= 0 || imageHeight <= 0 || heightM <= 0 || horizontalFovDeg <= 0 || verticalFovDeg <= 0) {
            return invalidProjection("invalid_input");
        }
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return invalidProjection("invalid_coordinates");
        }

        const horizontalOffsetDeg = ((pixelX / imageWidth) - 0.5) * horizontalFovDeg;
        const verticalOffsetDeg = ((pixelY / imageHeight) - 0.5) * verticalFovDeg;
        const effectiveDepressionDeg = depressionDeg + verticalOffsetDeg;

        if (effectiveDepressionDeg <= minDepressionDeg) {
            return invalidProjection("camera_near_horizon", {
                effectiveDepressionDeg,
                horizontalOffsetDeg,
                verticalOffsetDeg
            });
        }
        if (effectiveDepressionDeg > 120) {
            return invalidProjection("no_reasonable_intersection", {
                effectiveDepressionDeg,
                horizontalOffsetDeg,
                verticalOffsetDeg
            });
        }

        const distanceDepressionDeg = Math.min(effectiveDepressionDeg, 89.999);
        const distanceM = heightM / Math.tan(degToRad(distanceDepressionDeg));
        if (!Number.isFinite(distanceM) || distanceM < 0 || distanceM > maxDistanceM) {
            return invalidProjection("no_reasonable_intersection", {
                distanceM,
                effectiveDepressionDeg,
                horizontalOffsetDeg,
                verticalOffsetDeg
            });
        }

        const bearingDeg = normalizarGrados(yawDeg + horizontalOffsetDeg);
        const point = projectLatLon(latitude, longitude, distanceM, bearingDeg);

        return {
            valid: true,
            lat: point.lat,
            lon: point.lon,
            distanceM,
            bearingDeg,
            effectiveDepressionDeg,
            horizontalOffsetDeg,
            verticalOffsetDeg
        };
    }

    return {
        DEFAULT_DEPRESSION_DEG,
        MIN_INTERSECTION_DEPRESSION_DEG,
        DJI_PITCH_KEYS,
        normalizeDjiGimbalPitchToDepression,
        normalizeManualDepression,
        findDjiGimbalPitch,
        resolveCameraPitch,
        estimateVerticalFov,
        projectLatLon,
        projectPixelToGround
    };
}));
