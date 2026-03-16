const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const animationDir = path.join(rootDir, "use_controllers", "animation_controllers", "entity");
const renderDir = path.join(rootDir, "use_controllers", "render_controllers");
const outputPath = path.join(rootDir, "controller-manifest.js");

function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function collectAnimationControllers() {
    if (!fs.existsSync(animationDir)) {
        return [];
    }

    return fs.readdirSync(animationDir)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .flatMap((fileName) => {
            const filePath = path.join(animationDir, fileName);
            const json = readJson(filePath);
            const controllers = json.animation_controllers || {};

            return Object.entries(controllers).map(([name, controller]) => {
                const slots = [];
                const states = controller.states || {};

                Object.values(states).forEach((state) => {
                    const animations = Array.isArray(state.animations) ? state.animations : [];
                    animations.forEach((animation) => {
                        if (typeof animation === "string") {
                            pushUnique(slots, animation);
                            return;
                        }

                        if (animation && typeof animation === "object") {
                            Object.keys(animation).forEach((key) => pushUnique(slots, key));
                        }
                    });
                });

                return {
                    source: fileName,
                    name,
                    slots,
                };
            });
        });
}

function collectRenderControllers() {
    if (!fs.existsSync(renderDir)) {
        return [];
    }

    return fs.readdirSync(renderDir)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .flatMap((fileName) => {
            const filePath = path.join(renderDir, fileName);
            const json = readJson(filePath);
            const controllers = json.render_controllers || {};

            return Object.entries(controllers).map(([name, controller]) => ({
                source: fileName,
                name,
                geometryKeys: collectBindingKeys(controller.geometry, "Geometry"),
                textureKeys: collectBindingKeys(controller.textures, "Texture"),
                materialKeys: collectMaterialKeys(controller.materials),
                partVisibilityKeys: collectPartVisibilityKeys(controller.part_visibility),
            }));
        });
}

function collectBindingKeys(value, prefix) {
    const keys = [];

    if (Array.isArray(value)) {
        value.forEach((item) => collectBindingKeysInto(keys, item, prefix));
        return keys;
    }

    collectBindingKeysInto(keys, value, prefix);
    return keys;
}

function collectBindingKeysInto(target, value, prefix) {
    if (typeof value === "string") {
        pushUnique(target, normalizeBindingKey(value, prefix));
        return;
    }

    if (value && typeof value === "object") {
        Object.values(value).forEach((nestedValue) => collectBindingKeysInto(target, nestedValue, prefix));
    }
}

function collectMaterialKeys(materials) {
    const keys = [];
    if (!Array.isArray(materials)) {
        return keys;
    }

    materials.forEach((material) => {
        if (!material || typeof material !== "object") {
            return;
        }
        Object.values(material).forEach((value) => {
            if (typeof value === "string") {
                pushUnique(keys, normalizeBindingKey(value, "Material"));
            }
        });
    });
    return keys;
}

function collectPartVisibilityKeys(items) {
    const keys = [];
    if (!Array.isArray(items)) {
        return keys;
    }

    items.forEach((item) => {
        if (!item || typeof item !== "object") {
            return;
        }
        Object.keys(item).forEach((key) => pushUnique(keys, key));
    });
    return keys;
}

function normalizeBindingKey(value, prefix) {
    const marker = `${prefix}.`;
    return value.startsWith(marker) ? value.slice(marker.length) : value;
}

function pushUnique(target, value) {
    if (!value || target.includes(value)) {
        return;
    }
    target.push(value);
}

function main() {
    const manifest = {
        generatedAt: new Date().toISOString(),
        animationControllers: collectAnimationControllers(),
        renderControllers: collectRenderControllers(),
    };

    const content = [
        "// Generated from ./use_controllers by scripts/generate-controller-manifest.js",
        `window.BA_CONTROLLER_MANIFEST = ${JSON.stringify(manifest, null, 2)};`,
        "",
    ].join("\n");

    fs.writeFileSync(outputPath, content, "utf8");
    console.log(`Generated ${path.relative(rootDir, outputPath)}`);
}

main();
