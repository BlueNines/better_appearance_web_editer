const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const animationDir = path.join(rootDir, "use_controllers", "animation_controllers", "entity");
const renderDir = path.join(rootDir, "use_controllers", "render_controllers");
const descriptionPath = path.join(rootDir, "controller-descriptions.json");
const outputPath = path.join(rootDir, "controller-manifest.js");

/**
 * 统一读取 UTF-8 JSON，避免不同入口各写一遍。
 */
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * 读取控制器说明配置；文件不存在时回退为空对象。
 */
function readDescriptions() {
    if (!fs.existsSync(descriptionPath)) {
        return {
            animationControllers: {},
            renderControllers: {},
        };
    }

    const json = readJson(descriptionPath);
    return {
        animationControllers: json && json.animationControllers ? json.animationControllers : {},
        renderControllers: json && json.renderControllers ? json.renderControllers : {},
    };
}

/**
 * 收集动画控制器清单，并把中文说明一并编进 manifest。
 */
function collectAnimationControllers(descriptions) {
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
                const description = descriptions.animationControllers[name] || {};

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
                    label: description.label || "",
                    description: description.description || "",
                    slotDescriptions: description.slots || {},
                };
            });
        });
}

/**
 * 收集渲染控制器清单，并附带中文说明。
 */
function collectRenderControllers(descriptions) {
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

            return Object.entries(controllers).map(([name, controller]) => {
                const description = descriptions.renderControllers[name] || {};
                return {
                    source: fileName,
                    name,
                    geometryKeys: collectBindingKeys(controller.geometry, "Geometry"),
                    textureKeys: collectBindingKeys(controller.textures, "Texture"),
                    materialKeys: collectMaterialKeys(controller.materials),
                    partVisibilityKeys: collectPartVisibilityKeys(controller.part_visibility),
                    label: description.label || "",
                    description: description.description || "",
                };
            });
        });
}

/**
 * 解析 geometry / texture 这类绑定项里的 key。
 */
function collectBindingKeys(value, prefix) {
    const keys = [];

    if (Array.isArray(value)) {
        value.forEach((item) => collectBindingKeysInto(keys, item, prefix));
        return keys;
    }

    collectBindingKeysInto(keys, value, prefix);
    return keys;
}

/**
 * 递归提取绑定配置中的 key。
 */
function collectBindingKeysInto(target, value, prefix) {
    if (typeof value === "string") {
        pushUnique(target, normalizeBindingKey(value, prefix));
        return;
    }

    if (value && typeof value === "object") {
        Object.values(value).forEach((nestedValue) => collectBindingKeysInto(target, nestedValue, prefix));
    }
}

/**
 * 提取材质 key。
 */
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

/**
 * 提取部件显隐 key。
 */
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

/**
 * 去掉 Geometry.xxx / Texture.xxx 这类前缀，只保留编辑器真正要展示的 key。
 */
function normalizeBindingKey(value, prefix) {
    const marker = `${prefix}.`;
    return value.startsWith(marker) ? value.slice(marker.length) : value;
}

/**
 * 向数组中追加不重复值。
 */
function pushUnique(target, value) {
    if (!value || target.includes(value)) {
        return;
    }
    target.push(value);
}

/**
 * 生成并写出编辑器使用的控制器 manifest。
 */
function main() {
    const descriptions = readDescriptions();
    const manifest = {
        generatedAt: new Date().toISOString(),
        animationControllers: collectAnimationControllers(descriptions),
        renderControllers: collectRenderControllers(descriptions),
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
