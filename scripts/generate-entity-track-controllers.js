const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const projectDir = path.resolve(rootDir, "..", "..");
const webAnimationDir = path.join(rootDir, "use_controllers", "animation_controllers", "entity");
const webRenderPath = path.join(rootDir, "use_controllers", "render_controllers", "entity_default.render_controllers.json");
const componentDir = resolveComponentDir();
const componentAnimationDir = componentDir
    ? path.join(componentDir, "resource_packs", "better_appearance_res", "animation_controllers", "entity")
    : "";
const componentRenderPath = componentDir
    ? path.join(componentDir, "resource_packs", "better_appearance_res", "render_controllers", "entity_default.render_controllers.json")
    : "";
const descriptionPath = path.join(rootDir, "controller-descriptions.json");
const tracks = "abcdefghijklmnopqrstuvwxyz".split("");

/**
 * 解析组件目录；支持环境变量覆盖，避免仓库被软链接到其他盘符时找错兄弟目录。
 */
function resolveComponentDir() {
    if (process.env.BA_COMPONENT_DIR && fs.existsSync(process.env.BA_COMPONENT_DIR)) {
        return process.env.BA_COMPONENT_DIR;
    }

    const candidate = path.join(projectDir, "BetterAppearance组件");
    return fs.existsSync(candidate) ? candidate : "";
}

/**
 * 读取 UTF-8 JSON 文件。
 */
function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * 写出稳定格式的 UTF-8 JSON 文件。
 */
function writeJson(filePath, json) {
    fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
}

/**
 * 深拷贝普通 JSON 对象。
 */
function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

/**
 * 判断控制器是否可以作为多轨道模板。
 */
function isTrackTemplate(name) {
    return name.endsWith(".default") && name.indexOf("_wings.") === -1;
}

/**
 * 给状态名和动画 key 追加轨道后缀。
 */
function addTrackSuffix(value, suffix) {
    return suffix ? `${value}${suffix}` : value;
}

/**
 * 把 default 轨道的 molang 条件替换为目标轨道。
 */
function replaceEntitySkillMolang(value, molangId) {
    return typeof value === "string" ? value.replace(/query\.mod\.entity_skill/g, molangId) : value;
}

/**
 * 转换动画列表中的 slot 名。
 */
function transformAnimations(animations, suffix) {
    if (!Array.isArray(animations)) {
        return animations;
    }

    return animations.map((animation) => {
        if (typeof animation === "string") {
            return addTrackSuffix(animation, suffix);
        }
        if (!animation || typeof animation !== "object" || Array.isArray(animation)) {
            return cloneJson(animation);
        }

        const mapped = {};
        Object.keys(animation).forEach((key) => {
            mapped[addTrackSuffix(key, suffix)] = animation[key];
        });
        return mapped;
    });
}

/**
 * 转换状态跳转条件。
 */
function transformTransitions(transitions, suffix, molangId) {
    if (!Array.isArray(transitions)) {
        return transitions;
    }

    return transitions.map((transition) => {
        const mapped = {};
        Object.keys(transition).forEach((targetState) => {
            mapped[addTrackSuffix(targetState, suffix)] = replaceEntitySkillMolang(transition[targetState], molangId);
        });
        return mapped;
    });
}

/**
 * 基于 default 控制器生成指定轨道控制器。
 */
function buildTrackController(defaultController, track) {
    const suffix = track.toUpperCase();
    const molangId = `query.mod.entity_skill_${track}`;
    const controller = cloneJson(defaultController);
    const states = {};

    Object.keys(defaultController.states || {}).forEach((stateName) => {
        const sourceState = defaultController.states[stateName];
        const targetState = cloneJson(sourceState);
        targetState.transitions = transformTransitions(sourceState.transitions, suffix, molangId);
        targetState.animations = transformAnimations(sourceState.animations, suffix);
        states[addTrackSuffix(stateName, suffix)] = targetState;
    });

    controller.states = states;
    controller.initial_state = addTrackSuffix(defaultController.initial_state || "idle", suffix);
    return controller;
}

/**
 * 生成单个动画控制器文件内的 a-z 轨道。
 */
function buildAnimationControllerFile(json) {
    const sourceControllers = json.animation_controllers || {};
    const nextControllers = {};
    const templateBases = {};

    Object.keys(sourceControllers).forEach((name) => {
        if (isTrackTemplate(name)) {
            templateBases[name.replace(/\.default$/, "")] = true;
        }
    });

    Object.keys(sourceControllers).forEach((name) => {
        if (isGeneratedTrackController(name, templateBases)) {
            return;
        }
        if (!isTrackTemplate(name)) {
            nextControllers[name] = sourceControllers[name];
            return;
        }

        const defaultController = sourceControllers[name];
        nextControllers[name] = defaultController;
        tracks.forEach((track) => {
            nextControllers[name.replace(/\.default$/, `.${track}`)] = buildTrackController(defaultController, track);
        });
    });

    return {
        animation_controllers: nextControllers,
        format_version: json.format_version || "1.10.0",
    };
}

/**
 * 判断控制器是否是由 default 模板派生出的轨道控制器。
 */
function isGeneratedTrackController(name, templateBases) {
    const match = /^(.*)\.([a-z])$/.exec(name);
    return !!(match && templateBases[match[1]]);
}

/**
 * 生成渲染控制器文件内的 a-z 轨道。
 */
function buildRenderControllerFile(json) {
    const sourceControllers = json.render_controllers || {};
    const nextControllers = {};
    const trackRenderNameRegExp = /^controller\.render\.entity_default\.[a-z]\.third_person$/;

    Object.keys(sourceControllers).forEach((name) => {
        if (trackRenderNameRegExp.test(name)) {
            return;
        }
        nextControllers[name] = sourceControllers[name];
    });

    if (!nextControllers["controller.render.entity_default.third_person"]) {
        nextControllers["controller.render.entity_default.third_person"] = buildDefaultRenderController();
    }

    tracks.forEach((track) => {
        nextControllers[`controller.render.entity_default.${track}.third_person`] = {
            geometry: `Geometry.${track}`,
            textures: [
                `Texture.${track}`,
            ],
            materials: [
                {
                    "*": "Material.default",
                },
            ],
            part_visibility: [
                {
                    "*": `query.mod.entity_skill_${track} > 0.0`,
                },
            ],
        };
    });

    return {
        render_controllers: nextControllers,
        format_version: json.format_version || "1.8.0",
    };
}

/**
 * 构造默认本体渲染控制器，避免重复生成轨道时误删默认模型。
 */
function buildDefaultRenderController() {
    return {
        geometry: "Geometry.default",
        textures: [
            "Texture.default",
        ],
        materials: [
            {
                "*": "Material.default",
            },
        ],
        part_visibility: [
            {
                "*": true,
            },
        ],
    };
}

/**
 * 收集控制器中的动画 slot。
 */
function collectAnimationSlots(controller) {
    const slots = [];
    Object.keys(controller.states || {}).forEach((stateName) => {
        const animations = controller.states[stateName].animations || [];
        animations.forEach((animation) => {
            if (typeof animation === "string" && slots.indexOf(animation) === -1) {
                slots.push(animation);
            }
        });
    });
    return slots;
}

/**
 * 根据 slot 名生成基础中文说明。
 */
function describeSlot(slot) {
    if (slot.indexOf("idle") === 0) {
        return "配置待机动作。";
    }
    if (slot.indexOf("walk") === 0) {
        return "配置移动动作。";
    }
    const match = /^skill(\d+)/.exec(slot);
    if (match) {
        return `配置技能 ${match[1]} 动作。`;
    }
    return "配置动作。";
}

/**
 * 生成编辑器控制器说明，减少新增 26 轨后的空白项。
 */
function buildDescriptions(animationFiles, renderJson) {
    const descriptions = fs.existsSync(descriptionPath)
        ? readJson(descriptionPath)
        : { animationControllers: {}, renderControllers: {} };
    const animationDescriptions = descriptions.animationControllers || {};
    const renderDescriptions = descriptions.renderControllers || {};

    animationFiles.forEach((filePath) => {
        const json = readJson(filePath);
        Object.keys(json.animation_controllers || {}).forEach((name) => {
            const controller = json.animation_controllers[name];
            const slots = collectAnimationSlots(controller);
            const slotDescriptions = {};
            slots.forEach((slot) => {
                slotDescriptions[slot] = describeSlot(slot);
            });

            if (!animationDescriptions[name]) {
                animationDescriptions[name] = {
                    label: name,
                    description: `普通实体动作控制器，包含 ${slots.join("、")}。`,
                    slots: slotDescriptions,
                };
            }
        });
    });

    Object.keys(renderJson.render_controllers || {}).forEach((name) => {
        if (!renderDescriptions[name]) {
            renderDescriptions[name] = {
                label: name,
                description: "普通实体模型渲染控制器。",
            };
        }
    });

    return {
        animationControllers: animationDescriptions,
        renderControllers: renderDescriptions,
    };
}

/**
 * 生成 web 编辑器源文件并同步到组件资源目录。
 */
function main() {
    const animationFiles = fs.readdirSync(webAnimationDir)
        .filter((fileName) => fileName.endsWith(".json"))
        .sort()
        .map((fileName) => path.join(webAnimationDir, fileName));

    animationFiles.forEach((filePath) => {
        const nextJson = buildAnimationControllerFile(readJson(filePath));
        writeJson(filePath, nextJson);
        if (componentAnimationDir && fs.existsSync(componentAnimationDir)) {
            writeJson(path.join(componentAnimationDir, path.basename(filePath)), nextJson);
        }
    });

    const renderJson = buildRenderControllerFile(readJson(webRenderPath));
    writeJson(webRenderPath, renderJson);
    if (componentRenderPath) {
        writeJson(componentRenderPath, renderJson);
    }
    writeJson(descriptionPath, buildDescriptions(animationFiles, renderJson));

    console.log("Generated entity animation/render controllers for tracks a-z.");
}

main();
