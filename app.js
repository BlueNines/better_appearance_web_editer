(function () {
    "use strict";

    const ROOT_DIR = "生成模型";
    const RESOURCE_ROOT = "客户端组件/betterappearance/resource_packs/better_appearance_res";
    const CLIENT_ENTITY_ROOT = `${RESOURCE_ROOT}/entity`;
    const ENTITY_ROOT = "客户端组件/betterappearance/behavior_packs/better_appearance_beh/entities";
    const SERVER_ROOT = "服务端插件/ActionEffect/GeoAction/LivingEntityAction";
    const DEFAULT_SUBDIR = "monster";
    const DEFAULT_RENDER_CONTROLLER = "controller.render.entity_default.third_person";
    const DEFAULT_CONTROLLER = "controller.animation.entity_idle.default";
    const DEFAULT_ENTITY_PROFILE = {
        width: 1,
        height: 2,
        scale: 1,
    };
    const DEFAULT_TITLE_PROFILE = {
        text: "",
        textColor: "1.0,1.0,1.0,1.0",
        backgroundColor: "0,0,0,0.33",
        offset: "0.0,0.6,0.0",
        rotation: "0.0,0.0,0.0",
        scale: "1.5",
        depthTest: true,
    };
    const ANIMATION_TRACK_NAMES = ["scale", "position", "rotation"];
    const TIME_EPSILON = 1e-6;
    const CONTROLLER_DATA = getControllerData();
    const CONTROLLER_PRESETS = buildAnimationControllerPresets();
    const RENDER_CONTROLLER_PRESETS = buildRenderControllerPresets();

    const state = {
        entities: [],
        selectedEntityId: null,
        messages: [],
        pendingAssignment: null,
    };

    const elements = {
        resourceInput: document.getElementById("resourceInput"),
        newEntityButton: document.getElementById("newEntityButton"),
        exportButton: document.getElementById("exportButton"),
        projectStatus: document.getElementById("projectStatus"),
        statusText: document.getElementById("statusText"),
        entityCount: document.getElementById("entityCount"),
        entityList: document.getElementById("entityList"),
        inspector: document.getElementById("inspector"),
        dropZone: document.getElementById("dropZone"),
        outputPreview: document.getElementById("outputPreview"),
        messageList: document.getElementById("messageList"),
        assignInput: document.getElementById("assignInput"),
    };

    init();

    function init() {
        setStatus("等待导入资源文件。");
        bindEvents();
        render();
    }

    function bindEvents() {
        elements.resourceInput.addEventListener("change", async (event) => {
            await importFiles(event.target.files);
            event.target.value = "";
        });

        elements.newEntityButton.addEventListener("click", () => {
            const entity = createEntity("");
            state.entities.unshift(entity);
            selectEntity(entity.id);
            addMessage("已新建空实体，请填写基础名后再导出。", "info");
            render();
        });

        elements.exportButton.addEventListener("click", async () => {
            await exportZip();
        });

        elements.assignInput.addEventListener("change", async (event) => {
            const [file] = Array.from(event.target.files || []);
            const assignment = state.pendingAssignment;
            state.pendingAssignment = null;
            event.target.value = "";
            if (!assignment || !file) {
                return;
            }

            const entity = getEntityById(assignment.entityId);
            if (!entity) {
                addMessage("目标实体不存在，无法替换文件。", "error");
                render();
                return;
            }

            await assignFileToEntity(entity, file, assignment.type);
            render();
        });

        ["dragenter", "dragover"].forEach((eventName) => {
            elements.dropZone.addEventListener(eventName, (event) => {
                event.preventDefault();
                elements.dropZone.classList.add("is-dragging");
            });
        });

        ["dragleave", "drop"].forEach((eventName) => {
            elements.dropZone.addEventListener(eventName, (event) => {
                event.preventDefault();
                if (eventName === "drop") {
                    elements.dropZone.classList.remove("is-dragging");
                    void importFiles(event.dataTransfer.files, { preferSelectedEntityForDroppedFiles: true });
                    return;
                }
                const relatedTarget = event.relatedTarget;
                if (!relatedTarget || !elements.dropZone.contains(relatedTarget)) {
                    elements.dropZone.classList.remove("is-dragging");
                }
            });
        });
    }

    async function importFiles(fileList, options) {
        const files = Array.from(fileList || []);
        if (!files.length) {
            return;
        }

        const normalizedOptions = options || {};
        const preferredEntity = normalizedOptions.preferSelectedEntityForDroppedFiles
            ? getSelectedEntity()
            : null;

        let imported = 0;
        let skipped = 0;
        for (const file of files) {
            const success = await autoAssignFile(file, { preferredEntity });
            if (success) {
                imported += 1;
            } else {
                skipped += 1;
            }
        }

        if (imported) {
            setStatus(`已整理 ${imported} 个文件。`);
        }
        if (skipped) {
            addMessage(`有 ${skipped} 个文件未识别或导入失败。`, "warn");
        }
        render();
    }


    async function autoAssignFile(file, options) {
        try {
            const detected = await detectFilePayload(file);
            if (!detected) {
                addMessage(`未识别文件类型：${file.name}`, "warn");
                return false;
            }

            const preferredEntity = options && options.preferredEntity;
            if (preferredEntity && ["texture", "geometry", "animation"].includes(detected.type)) {
                await applyRecordToEntity(preferredEntity, detected);
                selectEntity(preferredEntity.id);
                addMessage(`已将${typeLabel(detected.type)}优先赋予当前选中实体：${preferredEntity.baseName || "未命名实体"}。`, "info");
                return true;
            }

            const candidateBaseName = deriveBaseNameFromFile(file.name, detected.type);
            let entity = findEntityByBaseName(candidateBaseName);
            if (!entity) {
                entity = createEntity(candidateBaseName);
                state.entities.unshift(entity);
            }

            await applyRecordToEntity(entity, detected);
            selectEntity(entity.id);
            return true;
        } catch (error) {
            addMessage(`导入 ${file.name} 失败：${error.message}`, "error");
            return false;
        }
    }

    async function assignFileToEntity(entity, file, expectedType) {
        try {
            const detected = await detectFilePayload(file, expectedType);
            if (!detected) {
                addMessage(`文件 ${file.name} 与目标类型不匹配。`, "warn");
                return;
            }
            await applyRecordToEntity(entity, detected);
            setStatus(`已替换 ${entity.baseName || "未命名实体"} 的${typeLabel(expectedType)}。`);
        } catch (error) {
            addMessage(`替换 ${file.name} 失败：${error.message}`, "error");
        }
    }

    async function detectFilePayload(file, forcedType) {
        const lowerName = file.name.toLowerCase();
        if (forcedType === "texture" || (!forcedType && lowerName.endsWith(".png"))) {
            return {
                type: "texture",
                file,
                buffer: await file.arrayBuffer(),
            };
        }

        if (!(lowerName.endsWith(".json") || forcedType === "geometry" || forcedType === "animation")) {
            return null;
        }

        const text = await file.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (_error) {
            throw new Error(`JSON 无法解析：${file.name}`);
        }

        if (forcedType === "geometry" || isGeometryJson(json, lowerName)) {
            return {
                type: "geometry",
                file,
                json,
            };
        }

        if (forcedType === "animation" || isAnimationJson(json, lowerName)) {
            return {
                type: "animation",
                file,
                json,
                animationNames: Object.keys(json.animations || {}),
            };
        }

        return null;
    }

    function isGeometryJson(json, lowerName) {
        return lowerName.endsWith(".geo.json") || Array.isArray(json["minecraft:geometry"]);
    }

    function isAnimationJson(json, lowerName) {
        return lowerName.endsWith(".animation.json")
            || (json && typeof json === "object" && json.animations && typeof json.animations === "object");
    }

    async function applyRecordToEntity(entity, detected) {
        if (detected.type === "texture") {
            entity.files.texture = {
                sourceName: detected.file.name,
                buffer: detected.buffer,
            };
            addMessage(`已载入贴图：${detected.file.name}`, "info");
            return;
        }

        if (detected.type === "geometry") {
            entity.files.geometry = {
                sourceName: detected.file.name,
                json: detected.json,
            };
            addMessage(`已载入模型：${detected.file.name}`, "info");
            return;
        }

        if (detected.type === "animation") {
            entity.files.animation = {
                sourceName: detected.file.name,
                json: detected.json,
                animationNames: detected.animationNames,
            };
            if (!entity.controllerManual) {
                entity.animateController = recommendController(detected.animationNames);
            }
            entity.animationMappings = buildAnimationMappings(entity.files.animation, getControllerSlots(entity.animateController), entity.animationMappings);
            addMessage(`已载入动作：${detected.file.name}`, "info");
        }
    }

    async function exportZip() {
        if (typeof window.JSZip === "undefined") {
            addMessage("JSZip 未加载，当前无法导出 ZIP。", "error");
            render();
            return;
        }

        const errors = collectExportErrors();
        if (errors.length) {
            selectEntity(errors[0].entityId);
            setStatus(errors[0].message);
            errors.slice(0, 4).forEach((error) => addMessage(error.message, "error"));
            render();
            return;
        }

        const zip = new window.JSZip();

        for (const entity of state.entities) {
            const normalized = buildNormalizedPayload(entity);
            const geometryPath = `${ROOT_DIR}/${RESOURCE_ROOT}/models/entity/${entity.resourceSubdir}/${entity.baseName}.geo.json`;
            const texturePath = `${ROOT_DIR}/${RESOURCE_ROOT}/textures/entity/${entity.resourceSubdir}/${entity.baseName}.png`;
            const animationPath = `${ROOT_DIR}/${RESOURCE_ROOT}/animations/${entity.resourceSubdir}/${entity.baseName}.animation.json`;
            const clientEntityPath = `${ROOT_DIR}/${CLIENT_ENTITY_ROOT}/${entity.baseName}.entity.json`;
            const entityPath = `${ROOT_DIR}/${ENTITY_ROOT}/${entity.baseName}.entity.json`;
            const ymlPath = `${ROOT_DIR}/${SERVER_ROOT}/${entity.baseName}.yml`;

            zip.file(texturePath, entity.files.texture.buffer);
            zip.file(geometryPath, JSON.stringify(normalized.geometryJson));
            zip.file(animationPath, JSON.stringify(normalized.animationJson));
            zip.file(clientEntityPath, JSON.stringify(normalized.clientEntityJson));
            zip.file(entityPath, JSON.stringify(normalized.entityJson));
            zip.file(ymlPath, normalized.ymlText);
        }

        const blob = await zip.generateAsync({ type: "blob" });
        const downloadName = `betterappearance-export-${createTimestamp()}.zip`;
        downloadBlob(blob, downloadName);
        setStatus(`导出完成：${downloadName}`);
        addMessage(`已导出 ${state.entities.length} 个实体的 ZIP，未更新 Config.py。`, "info");
        render();
    }

    function collectExportErrors() {
        const errors = [];
        for (const entity of state.entities) {
            const name = entity.baseName || "未命名实体";
            if (!entity.baseName.trim()) {
                errors.push({ entityId: entity.id, message: `${name} 缺少实体基础名。` });
            }
            if (!/^[a-z0-9_]+$/i.test(entity.baseName.trim())) {
                errors.push({ entityId: entity.id, message: `${name} 的基础名只允许字母、数字、下划线。` });
            }
            if (!/^[a-z0-9_]+:[a-z0-9_]+$/i.test(entity.identifier.trim())) {
                errors.push({ entityId: entity.id, message: `${name} 的命名空间标识符格式应为 namespace:name。` });
            }
            if (!/^[a-z0-9_/-]+$/i.test(entity.resourceSubdir.trim())) {
                errors.push({ entityId: entity.id, message: `${name} 的资源子目录只允许字母、数字、下划线、短横线、斜杠。` });
            }
            if (!Number.isFinite(entity.entityProfile.width) || entity.entityProfile.width <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的碰撞箱宽度必须大于 0。` });
            }
            if (!Number.isFinite(entity.entityProfile.height) || entity.entityProfile.height <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的碰撞箱高度必须大于 0。` });
            }
            if (!Number.isFinite(entity.entityProfile.scale) || entity.entityProfile.scale <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的模型缩放必须大于 0。` });
            }
            if (!entity.files.texture) {
                errors.push({ entityId: entity.id, message: `${name} 缺少贴图文件。` });
            }
            if (!entity.files.geometry) {
                errors.push({ entityId: entity.id, message: `${name} 缺少模型文件。` });
            }
            if (!entity.files.animation) {
                errors.push({ entityId: entity.id, message: `${name} 缺少动作文件。` });
            }
            if (entity.files.animation && !Object.values(entity.animationMappings || {}).filter(Boolean).length) {
                errors.push({ entityId: entity.id, message: `${name} 没有可导出的动作槽位映射。` });
            }
        }
        return dedupeErrors(errors);
    }

    function buildNormalizedPayload(entity) {
        const geometryJson = normalizeGeometryJson(entity);
        const animationJson = normalizeAnimationJson(entity);
        const animateList = createAnimateList(entity);
        const renderBindings = collectRenderBindings(entity);
        const entityJson = createEntityJson(entity);
        const clientEntityJson = createClientEntityJson(entity, animateList, renderBindings);

        return {
            geometryJson,
            animationJson,
            entityJson,
            clientEntityJson,
            ymlText: createYmlText(entity, animateList, renderBindings),
        };
    }

    function normalizeGeometryJson(entity) {
        const geometryJson = deepClone(entity.files.geometry.json);
        const geometries = geometryJson["minecraft:geometry"];
        if (Array.isArray(geometries) && geometries.length) {
            geometries.forEach((item, index) => {
                item.description = item.description || {};
                if (index === 0) {
                    item.description.identifier = `geometry.${entity.baseName}`;
                }
            });
        }
        if (!geometryJson.format_version) {
            geometryJson.format_version = "1.12.0";
        }
        return geometryJson;
    }

    function normalizeAnimationJson(entity) {
        const baseJson = deepClone(entity.files.animation.json);
        const renamedAnimations = {};
        const sourceAnimations = entity.files.animation.json.animations || {};

        getControllerSlots(entity.animateController).forEach((slotName) => {
            const mappedName = entity.animationMappings[slotName];
            if (!mappedName || !sourceAnimations[mappedName]) {
                return;
            }
            renamedAnimations[`animation.${entity.baseName}.${slotName}`] = deepClone(sourceAnimations[mappedName]);
        });

        baseJson.animations = renamedAnimations;
        if (!baseJson.format_version) {
            baseJson.format_version = "1.8.0";
        }
        padAnimationTracksToTail(baseJson);
        return baseJson;
    }

    function padAnimationTracksToTail(animationJson) {
        const animations = animationJson && animationJson.animations;
        if (!animations || typeof animations !== "object") {
            return;
        }

        Object.values(animations).forEach((animationBody) => {
            if (!animationBody || typeof animationBody !== "object") {
                return;
            }

            const animationLength = animationBody.animation_length;
            if (typeof animationLength !== "number" || !Number.isFinite(animationLength)) {
                return;
            }

            const bones = animationBody.bones;
            if (!bones || typeof bones !== "object") {
                return;
            }

            Object.values(bones).forEach((boneBody) => {
                if (!boneBody || typeof boneBody !== "object") {
                    return;
                }

                ANIMATION_TRACK_NAMES.forEach((trackName) => {
                    const channel = boneBody[trackName];
                    if (!isKeyframedAnimationChannel(channel)) {
                        return;
                    }

                    const frames = getNumericKeyframes(channel);
                    if (!frames.length) {
                        return;
                    }

                    const lastFrame = frames[frames.length - 1];
                    if (Math.abs(lastFrame.time - animationLength) <= TIME_EPSILON || lastFrame.time > animationLength) {
                        return;
                    }

                    const finalKey = formatAnimationTimeKey(animationLength, frames.map((frame) => frame.key));
                    channel[finalKey] = deepClone(channel[lastFrame.key]);
                });
            });
        });
    }

    function isKeyframedAnimationChannel(channel) {
        if (!channel || typeof channel !== "object" || Array.isArray(channel)) {
            return false;
        }

        return Object.keys(channel).some((key) => isNumericTimeKey(key));
    }

    function getNumericKeyframes(channel) {
        return Object.keys(channel)
            .filter((key) => isNumericTimeKey(key))
            .map((key) => ({ time: Number.parseFloat(key), key }))
            .sort((left, right) => left.time - right.time);
    }

    function isNumericTimeKey(value) {
        if (typeof value !== "string" && typeof value !== "number") {
            return false;
        }

        const text = String(value).trim();
        if (!text) {
            return false;
        }

        const parsed = Number(text);
        return Number.isFinite(parsed);
    }

    function formatAnimationTimeKey(animationLength, existingKeys) {
        const hasDecimalKey = existingKeys.some((key) => String(key).includes("."));
        if (Math.abs(animationLength - Math.round(animationLength)) <= TIME_EPSILON) {
            const rounded = Math.round(animationLength);
            return hasDecimalKey ? `${rounded}.0` : String(rounded);
        }

        let text = animationLength.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        if (!text.includes(".") && hasDecimalKey) {
            text += ".0";
        }
        return text;
    }

    function createEntityJson(entity) {
        return {
            format_version: "1.10.0",
            "minecraft:entity": {
                description: {
                    identifier: entity.identifier,
                },
                component_groups: {},
                components: {},
                events: {},
            },
        };
    }

    function createClientEntityJson(entity, animateList, renderBindings) {
        const animations = {
            scale: "animation.entity.auto.scale",
        };
        animateList.forEach((item) => {
            animations[item.key] = item.name;
        });

        const materials = {};
        (renderBindings.materialKeys.length ? renderBindings.materialKeys : ["default"]).forEach((key) => {
            materials[key] = "entity_alphatest";
        });

        const textures = {};
        renderBindings.textureKeys.forEach((key) => {
            textures[key] = `textures/entity/${entity.resourceSubdir}/${entity.baseName}`;
        });

        const geometry = {};
        renderBindings.geometryKeys.forEach((key) => {
            geometry[key] = `geometry.${entity.baseName}`;
        });

        return {
            format_version: "1.8.0",
            "minecraft:client_entity": {
                description: {
                    identifier: entity.identifier,
                    materials,
                    textures,
                    geometry,
                    animations,
                    animation_controllers: [
                        {
                            default: entity.animateController,
                        },
                        {
                            scale: "controller.animation.auto.scale",
                        },
                    ],
                    render_controllers: [
                        entity.renderController,
                    ],
                },
            },
        };
    }

    function createAnimateList(entity) {
        return getControllerSlots(entity.animateController)
            .filter((slotName) => entity.animationMappings[slotName])
            .map((slotName) => ({
                key: slotName,
                name: `animation.${entity.baseName}.${slotName}`,
            }));
    }

    function createYmlText(entity, animateList, renderBindings) {
        const lines = [
            `${entity.baseName}:`,
            `  entityIdentifier: ${entity.identifier}`,
            "  geometry:",
        ];

        renderBindings.geometryKeys.forEach((key) => {
            lines.push(`  - key: ${key}`);
            lines.push(`    name: geometry.${entity.baseName}`);
        });

        lines.push("  texture:");
        renderBindings.textureKeys.forEach((key) => {
            lines.push(`  - key: ${key}`);
            lines.push(`    name: textures/entity/${entity.resourceSubdir}/${entity.baseName}`);
        });

        lines.push("  render:");
        lines.push(`  - controller: ${entity.renderController}`);
        lines.push("    condition: ''");
        lines.push("  animate:");

        if (animateList.length) {
            animateList.forEach((item) => {
                lines.push(`  - key: ${item.key}`);
                lines.push(`    name: ${item.name}`);
            });
        } else {
            lines.push("  []");
        }

        lines.push("  animate_controller:");
        lines.push("  - key: default");
        lines.push(`    name: ${entity.animateController}`);

        const entityProfileLines = buildEntityProfileLines(entity);
        if (entityProfileLines.length) {
            lines.push("  entity_profile:");
            entityProfileLines.forEach((line) => lines.push(line));
        }

        return lines.join("\n");
    }

    /**
     * 只组装需要导出的实体服务端 profile 字段，避免把空标题或无效字段写进 yml。
     */
    function buildEntityProfileLines(entity) {
        const lines = [];
        const titleProfile = getEntityTitleProfile(entity);
        const changedTitleEntries = getChangedTitleProfileEntries(titleProfile);

        if (hasCustomNumericEntityProfile(entity)) {
            lines.push("    # 碰撞箱");
            lines.push(`    width: ${entity.entityProfile.width}`);
            lines.push(`    height: ${entity.entityProfile.height}`);
            lines.push("    # 模型缩放");
            lines.push(`    scale: ${entity.entityProfile.scale}`);
        }

        if (hasEntityTitleProfile(entity) && changedTitleEntries.length) {
            lines.push("    title:");
            changedTitleEntries.forEach((entry) => {
                lines.push(`      ${entry.key}: ${entry.value}`);
            });
        }

        return lines;
    }

    /**
     * 标题 profile 采用“按默认值导出差异”的策略，避免把默认参数重复写进 yml。
     */
    function getChangedTitleProfileEntries(titleProfile) {
        const entries = [];

        if (isTitleTextChanged(titleProfile.text)) {
            entries.push({ key: "text", value: quoteYamlString(titleProfile.text) });
        }
        if (isNormalizedTitleFieldChanged(titleProfile.textColor, DEFAULT_TITLE_PROFILE.textColor, normalizeTitleColorValue)) {
            entries.push({ key: "textColor", value: quoteYamlString(titleProfile.textColor) });
        }
        if (isNormalizedTitleFieldChanged(titleProfile.backgroundColor, DEFAULT_TITLE_PROFILE.backgroundColor, normalizeTitleColorValue)) {
            entries.push({ key: "backgroundColor", value: quoteYamlString(titleProfile.backgroundColor) });
        }
        if (isNormalizedTitleFieldChanged(titleProfile.offset, DEFAULT_TITLE_PROFILE.offset, normalizeTitleVector3Value)) {
            entries.push({ key: "offset", value: quoteYamlString(titleProfile.offset) });
        }
        if (isNormalizedTitleFieldChanged(titleProfile.rotation, DEFAULT_TITLE_PROFILE.rotation, normalizeTitleVector3Value)) {
            entries.push({ key: "rotation", value: quoteYamlString(titleProfile.rotation) });
        }
        if (isNormalizedTitleFieldChanged(titleProfile.scale, DEFAULT_TITLE_PROFILE.scale, normalizeTitleBoardScaleValue)) {
            entries.push({ key: "scale", value: quoteYamlString(titleProfile.scale) });
        }
        if (isNormalizedTitleDepthTestChanged(titleProfile.depthTest)) {
            entries.push({ key: "depthTest", value: String(Boolean(titleProfile.depthTest)) });
        }

        return entries;
    }

    /**
     * 保持旧逻辑：只要碰撞箱或模型缩放有任意一个被改过，就一起导出三项基础数值。
     */
    function hasCustomNumericEntityProfile(entity) {
        return entity.entityProfile.width !== DEFAULT_ENTITY_PROFILE.width
            || entity.entityProfile.height !== DEFAULT_ENTITY_PROFILE.height
            || entity.entityProfile.scale !== DEFAULT_ENTITY_PROFILE.scale;
    }

    /**
     * 标题只在存在文本时才导出，和服务端解析逻辑保持一致。
     */
    function hasEntityTitleProfile(entity) {
        const titleProfile = getEntityTitleProfile(entity);
        return isTitleTextChanged(titleProfile.text);
    }

    /**
     * 标题文本是 title 块的锚点，仍然必须非空。
     */
    function isTitleTextChanged(value) {
        const text = normalizeTitleTextValue(value);
        return text !== normalizeTitleTextValue(DEFAULT_TITLE_PROFILE.text);
    }

    /**
     * 普通字符串字段走“规范化后比较”的逻辑，兼容 0 和 0.0 这种等价写法。
     */
    function isNormalizedTitleFieldChanged(currentValue, defaultValue, normalizer) {
        const current = normalizer(currentValue);
        const fallback = normalizer(defaultValue);
        if (!current) {
            return false;
        }
        return current !== fallback;
    }

    /**
     * `depthTest` 默认是 true；null 视为“使用默认值”，因此不参与导出。
     */
    function isNormalizedTitleDepthTestChanged(value) {
        if (value == null) {
            return false;
        }
        return Boolean(value) !== DEFAULT_TITLE_PROFILE.depthTest;
    }

    function parseEntityProfileValue(value, fallback) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    /**
     * 把标题深度测试下拉框的值转成三态布尔。
     */
    function parseOptionalBoolean(value) {
        if (value === "true") {
            return true;
        }
        if (value === "false") {
            return false;
        }
        return null;
    }

    function bindEntityProfileInput(input, entity, key, fallback) {
        input.addEventListener("input", (event) => {
            entity.entityProfile[key] = parseEntityProfileValue(event.target.value, fallback);
        });

        input.addEventListener("change", (event) => {
            entity.entityProfile[key] = parseEntityProfileValue(event.target.value, fallback);
            event.target.value = String(entity.entityProfile[key]);
            render();
        });
    }

    /**
     * 绑定标题 profile 的普通文本输入框。
     */
    function bindTitleProfileInput(input, entity, key) {
        input.addEventListener("input", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
        });

        input.addEventListener("change", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
            render();
        });
    }

    /**
     * 绑定标题 profile 的深度测试下拉框。
     */
    function bindTitleDepthTestSelect(select, entity) {
        select.addEventListener("change", (event) => {
            getEntityTitleProfile(entity).depthTest = parseOptionalBoolean(event.target.value);
            render();
        });
    }

    function render() {
        syncSelection();
        renderProjectStatus();
        renderEntityList();
        renderInspector();
        renderOutputPreview();
        renderMessages();
        elements.entityCount.textContent = String(state.entities.length);
        elements.exportButton.disabled = state.entities.length === 0;
    }
    function renderProjectStatus() {
        elements.projectStatus.textContent = "导出 ZIP 时不会更新 better_appearance_scripts/config/living_entity/Config.py";
    }

    function renderEntityList() {
        if (!state.entities.length) {
            elements.entityList.innerHTML = '<li class="empty-state">还没有实体，先导入资源文件。</li>';
            return;
        }

        elements.entityList.innerHTML = state.entities.map((entity) => {
            const isSelected = entity.id === state.selectedEntityId;
            const title = entity.baseName || "未命名实体";
            const chips = [
                entity.files.texture ? "贴图" : null,
                entity.files.geometry ? "模型" : null,
                entity.files.animation ? "动作" : null,
            ].filter(Boolean);
            return `
                <li>
                    <button class="entity-item ${isSelected ? "is-selected" : ""}" type="button" data-entity-select="${entity.id}">
                        <div class="entity-item-top">
                            <div>
                                <p class="entity-title">${escapeHtml(title)}</p>
                                <p class="entity-subtitle">${escapeHtml(entity.identifier || "等待填写标识符")}</p>
                            </div>
                            <span class="chip ${chips.length === 3 ? "" : "warn"}">${chips.length}/3</span>
                        </div>
                        <div class="chip-row">
                            ${chips.length ? chips.map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("") : '<span class="chip muted">未导入文件</span>'}
                        </div>
                    </button>
                </li>
            `;
        }).join("");

        elements.entityList.querySelectorAll("[data-entity-select]").forEach((button) => {
            button.addEventListener("click", () => {
                selectEntity(button.dataset.entitySelect);
                render();
            });
        });
    }

    function renderInspector() {
        const entity = getSelectedEntity();
        if (!entity) {
            elements.inspector.className = "inspector empty-state";
            elements.inspector.textContent = "先导入资源文件，或新建一个空实体。";
            return;
        }

        elements.inspector.className = "inspector";
        const slots = getControllerSlots(entity.animateController);
        const renderBindings = collectRenderBindings(entity);
        const titleProfile = getEntityTitleProfile(entity);
        const titleTextColorState = getColorEditorState(titleProfile.textColor);
        const titleBackgroundColorState = getColorEditorState(titleProfile.backgroundColor);
        const titleDepthTestValue = titleProfile.depthTest === true
            ? "true"
            : titleProfile.depthTest === false
                ? "false"
                : "";
        const availableAnimations = entity.files.animation ? entity.files.animation.animationNames : [];
        const usedAnimationNames = new Set(Object.values(entity.animationMappings).filter(Boolean));
        const unusedAnimations = availableAnimations.filter((name) => !usedAnimationNames.has(name));

        elements.inspector.innerHTML = `
            <div class="detail-actions">
                <button class="button ghost" type="button" data-action="duplicate-entity">复制当前实体</button>
                <button class="button danger" type="button" data-action="delete-entity">删除当前实体</button>
            </div>

            <section class="section-card">
                <div class="form-grid">
                    <div class="field">
                        <label for="baseNameInput">实体基础名</label>
                        <input id="baseNameInput" type="text" value="${escapeAttribute(entity.baseName)}" placeholder="例如 bigmouthedflower">
                        <p class="field-hint">会用于文件名、geometry 标识符和动画名。</p>
                    </div>

                    <div class="field">
                        <label for="identifierInput">命名空间标识符</label>
                        <input id="identifierInput" type="text" value="${escapeAttribute(entity.identifier)}" placeholder="netease:bigmouthedflower">
                        <p class="field-hint">默认跟随基础名自动变成 <code>netease:实体基础名</code>。</p>
                    </div>

                    <div class="field">
                        <label for="resourceSubdirInput">资源子目录</label>
                        <input id="resourceSubdirInput" type="text" value="${escapeAttribute(entity.resourceSubdir)}" placeholder="${DEFAULT_SUBDIR}">
                        <p class="field-hint">对应贴图、模型、动作输出目录，例如 <code>monster</code>。</p>
                    </div>

                    <div class="field">
                        <label for="renderControllerSelect">渲染控制器</label>
                        <select id="renderControllerSelect">
                            ${RENDER_CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === entity.renderController ? "selected" : ""}>${preset.name}</option>`).join("")}
                        </select>
                        <p class="field-hint">来自 <code>use_controllers/render_controllers</code>。</p>
                    </div>

                    <div class="field">
                        <label for="controllerSelect">动画控制器</label>
                        <select id="controllerSelect">
                            ${CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === entity.animateController ? "selected" : ""}>${preset.name}</option>`).join("")}
                        </select>
                        <p class="field-hint">动画 key 来自 <code>use_controllers/animation_controllers</code>。</p>
                    </div>

                </div>
            </section>

            <section class="section-card">
                <h3>碰撞箱和缩放</h3>
                    <div class="slot-grid">
                    <div class="field">
                                                    <label for="profileWidthInput">碰撞箱宽度</label>
                                                    <input id="profileWidthInput" type="number" min="0.01" step="any" value="${escapeAttribute(entity.entityProfile.width)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，支持小数，仅在服务端插件配置中使用。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileHeightInput">碰撞箱高度</label>
                                                    <input id="profileHeightInput" type="number" min="0.01" step="any" value="${escapeAttribute(entity.entityProfile.height)}">
                                                    <p class="field-hint">默认值为 <code>2</code>，支持小数，仅在服务端插件配置中使用。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileScaleInput">模型缩放</label>
                                                    <input id="profileScaleInput" type="number" min="0.01" step="any" value="${escapeAttribute(entity.entityProfile.scale)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，支持小数。</p>
                                                </div>
                    </div>
                ${unusedAnimations.length ? `<div class="chip-row">${unusedAnimations.map((name) => `<span class="chip muted">${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="field-hint"></p>'}
            </section>

            <section class="section-card">
                <h3>头顶标题</h3>
                <div class="form-grid">
                    <div class="field field-wide">
                        <label for="titleTextInput">标题文本</label>
                        <input id="titleTextInput" type="text" value="${escapeAttribute(titleProfile.text)}" placeholder="例如 松鼠">
                        <p class="field-hint">默认标题配置只有改动项会导出；标题文本仍然必须非空才会生成 <code>entity_profile.title</code>。</p>
                    </div>

                    ${renderTitleColorField({
                        idPrefix: "titleTextColor",
                        label: "文字颜色",
                        value: titleProfile.textColor,
                        placeholder: DEFAULT_TITLE_PROFILE.textColor,
                        hint: "默认值是白色；可直接用色盘选色，透明度单独调，下方原始 RGBA 仍可手改。",
                        colorState: titleTextColorState,
                    })}

                    ${renderTitleColorField({
                        idPrefix: "titleBackgroundColor",
                        label: "背景颜色",
                        value: titleProfile.backgroundColor,
                        placeholder: DEFAULT_TITLE_PROFILE.backgroundColor,
                        hint: "默认值是半透明黑底；支持色盘与透明度，只有改动项才会导出。",
                        colorState: titleBackgroundColorState,
                    })}

                    <div class="field">
                        <label for="titleOffsetInput">偏移</label>
                        <input id="titleOffsetInput" type="text" value="${escapeAttribute(titleProfile.offset)}" placeholder="${escapeAttribute(DEFAULT_TITLE_PROFILE.offset)}">
                        <p class="field-hint">XYZ，默认值为 <code>${escapeHtml(DEFAULT_TITLE_PROFILE.offset)}</code>。</p>
                    </div>

                    <div class="field">
                        <label for="titleRotationInput">旋转</label>
                        <input id="titleRotationInput" type="text" value="${escapeAttribute(titleProfile.rotation)}" placeholder="${escapeAttribute(DEFAULT_TITLE_PROFILE.rotation)}">
                        <p class="field-hint">XYZ，默认值为 <code>${escapeHtml(DEFAULT_TITLE_PROFILE.rotation)}</code>。</p>
                    </div>

                    <div class="field">
                        <label for="titleScaleInput">标题缩放</label>
                        <input id="titleScaleInput" type="text" value="${escapeAttribute(titleProfile.scale)}" placeholder="${escapeAttribute(DEFAULT_TITLE_PROFILE.scale)}">
                        <p class="field-hint">默认值是 <code>${escapeHtml(DEFAULT_TITLE_PROFILE.scale)}</code>。</p>
                    </div>

                    <div class="field">
                        <label for="titleDepthTestSelect">深度测试</label>
                        <select id="titleDepthTestSelect">
                            <option value="" ${titleDepthTestValue === "" ? "selected" : ""}>使用默认值（true）</option>
                            <option value="true" ${titleDepthTestValue === "true" ? "selected" : ""}>true</option>
                            <option value="false" ${titleDepthTestValue === "false" ? "selected" : ""}>false</option>
                        </select>
                        <p class="field-hint">默认值为 <code>true</code>，只有改成 <code>false</code> 才会导出。</p>
                    </div>
                </div>
            </section>

            <section class="section-card">
                <h3>动作槽位映射</h3>
                ${slots.length ? `
                    <div class="slot-grid">
                        ${slots.map((slotName) => `
                            <div class="slot-card">
                                <h4>${slotName}</h4>
                                <select data-slot-select="${slotName}">
                                    <option value="">不导出这个槽位</option>
                                    ${availableAnimations.map((animationName) => `<option value="${escapeAttribute(animationName)}" ${entity.animationMappings[slotName] === animationName ? "selected" : ""}>${escapeHtml(animationName)}</option>`).join("")}
                                </select>
                                <p>${entity.animationMappings[slotName] ? `导出后会改写为 animation.${entity.baseName || "实体名"}.${slotName}` : "当前槽位未映射"}</p>
                            </div>
                        `).join("")}
                    </div>
                ` : '<p class="empty-state">当前控制器没有可用槽位。</p>'}
                ${unusedAnimations.length ? `<div class="chip-row">${unusedAnimations.map((name) => `<span class="chip muted">${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="field-hint">当前动作文件中的动画块都已被使用。</p>'}
            </section>

            <section class="section-card">
                <h3>已载入文件</h3>
                <div class="file-stack">
                    ${renderFileCard("贴图文件", "texture", entity.files.texture ? entity.files.texture.sourceName : "")}
                    ${renderFileCard("模型文件", "geometry", entity.files.geometry ? entity.files.geometry.sourceName : "")}
                    ${renderFileCard("动作文件", "animation", entity.files.animation ? entity.files.animation.sourceName : "")}
                </div>
            </section>

            <section class="section-card">
                <h3>控制器 Key 参考</h3>
                <div class="file-stack">
                    <div class="file-card">
                        <p class="file-title">渲染控制器绑定</p>
                        <div class="chip-row">
                            ${renderBindings.geometryKeys.length ? renderBindings.geometryKeys.map((key) => `<span class="chip">Geometry.${escapeHtml(key)}</span>`).join("") : '<span class="chip muted">无 geometry key</span>'}
                        </div>
                        <div class="chip-row">
                            ${renderBindings.textureKeys.length ? renderBindings.textureKeys.map((key) => `<span class="chip">Texture.${escapeHtml(key)}</span>`).join("") : '<span class="chip muted">无 texture key</span>'}
                        </div>
                        <div class="chip-row">
                            ${renderBindings.materialKeys.length ? renderBindings.materialKeys.map((key) => `<span class="chip muted">Material.${escapeHtml(key)}</span>`).join("") : '<span class="chip muted">无 material key</span>'}
                        </div>
                    </div>
                    <div class="file-card">
                        <p class="file-title">动画控制器可用 key</p>
                        <div class="chip-row">
                            ${slots.length ? slots.map((slotName) => `<span class="chip">${escapeHtml(slotName)}</span>`).join("") : '<span class="chip muted">当前控制器没有动画 key</span>'}
                        </div>
                    </div>
                </div>
            </section>

        `;

        bindInspectorEvents(entity);
    }

    function bindInspectorEvents(entity) {
        const baseNameInput = document.getElementById("baseNameInput");
        const identifierInput = document.getElementById("identifierInput");
        const resourceSubdirInput = document.getElementById("resourceSubdirInput");
        const renderControllerSelect = document.getElementById("renderControllerSelect");
        const controllerSelect = document.getElementById("controllerSelect");
        const profileWidthInput = document.getElementById("profileWidthInput");
        const profileHeightInput = document.getElementById("profileHeightInput");
        const profileScaleInput = document.getElementById("profileScaleInput");
        const titleTextInput = document.getElementById("titleTextInput");
        const titleTextColorInput = document.getElementById("titleTextColorInput");
        const titleTextColorPicker = document.getElementById("titleTextColorPicker");
        const titleTextColorAlphaInput = document.getElementById("titleTextColorAlphaInput");
        const titleBackgroundColorInput = document.getElementById("titleBackgroundColorInput");
        const titleBackgroundColorPicker = document.getElementById("titleBackgroundColorPicker");
        const titleBackgroundColorAlphaInput = document.getElementById("titleBackgroundColorAlphaInput");
        const titleOffsetInput = document.getElementById("titleOffsetInput");
        const titleRotationInput = document.getElementById("titleRotationInput");
        const titleScaleInput = document.getElementById("titleScaleInput");
        const titleDepthTestSelect = document.getElementById("titleDepthTestSelect");

        baseNameInput.addEventListener("input", (event) => {
            const focusState = captureInspectorFocus();
            entity.baseName = event.target.value;
            if (entity.identifierMode !== "manual") {
                entity.identifier = entity.baseName ? `netease:${entity.baseName}` : "";
            }
            render();
            restoreInspectorFocus(focusState);
        });

        identifierInput.addEventListener("input", (event) => {
            const focusState = captureInspectorFocus();
            const value = event.target.value;
            entity.identifier = value;
            const expectedAuto = entity.baseName ? `netease:${entity.baseName}` : "";
            entity.identifierMode = value === expectedAuto || value === "" ? "auto" : "manual";
            render();
            restoreInspectorFocus(focusState);
        });

        resourceSubdirInput.addEventListener("input", (event) => {
            entity.resourceSubdir = event.target.value;
            renderOutputPreview();
        });

        renderControllerSelect.addEventListener("change", (event) => {
            entity.renderController = event.target.value;
            render();
        });

        controllerSelect.addEventListener("change", (event) => {
            entity.animateController = event.target.value;
            entity.controllerManual = true;
            entity.animationMappings = buildAnimationMappings(entity.files.animation, getControllerSlots(entity.animateController), entity.animationMappings);
            render();
        });

        bindEntityProfileInput(profileWidthInput, entity, "width", DEFAULT_ENTITY_PROFILE.width);
        bindEntityProfileInput(profileHeightInput, entity, "height", DEFAULT_ENTITY_PROFILE.height);
        bindEntityProfileInput(profileScaleInput, entity, "scale", DEFAULT_ENTITY_PROFILE.scale);
        bindTitleProfileInput(titleTextInput, entity, "text");
        bindTitleColorEditor(entity, "textColor", titleTextColorInput, titleTextColorPicker, titleTextColorAlphaInput);
        bindTitleColorEditor(entity, "backgroundColor", titleBackgroundColorInput, titleBackgroundColorPicker, titleBackgroundColorAlphaInput);
        bindTitleProfileInput(titleOffsetInput, entity, "offset");
        bindTitleProfileInput(titleRotationInput, entity, "rotation");
        bindTitleProfileInput(titleScaleInput, entity, "scale");
        bindTitleDepthTestSelect(titleDepthTestSelect, entity);

        elements.inspector.querySelectorAll("[data-file-assign]").forEach((button) => {
            button.addEventListener("click", () => {
                const type = button.dataset.fileAssign;
                state.pendingAssignment = { entityId: entity.id, type };
                elements.assignInput.accept = type === "texture" ? ".png" : ".json";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-file-remove]").forEach((button) => {
            button.addEventListener("click", () => {
                const type = button.dataset.fileRemove;
                entity.files[type] = null;
                if (type === "animation") {
                    entity.animationMappings = {};
                }
                setStatus(`已移除 ${typeLabel(type)}。`);
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-slot-select]").forEach((select) => {
            select.addEventListener("change", (event) => {
                entity.animationMappings[event.target.dataset.slotSelect] = event.target.value;
                render();
            });
        });

        elements.inspector.querySelector("[data-action='duplicate-entity']").addEventListener("click", () => {
            const clone = createEntity(entity.baseName);
            clone.identifier = entity.identifier;
            clone.identifierMode = entity.identifierMode;
            clone.resourceSubdir = entity.resourceSubdir;
            clone.renderController = entity.renderController;
            clone.animateController = entity.animateController;
            clone.controllerManual = entity.controllerManual;
            clone.entityProfile = {
                width: entity.entityProfile.width,
                height: entity.entityProfile.height,
                scale: entity.entityProfile.scale,
                title: { ...getEntityTitleProfile(entity) },
            };
            clone.files = {
                texture: entity.files.texture ? { ...entity.files.texture } : null,
                geometry: entity.files.geometry ? { sourceName: entity.files.geometry.sourceName, json: deepClone(entity.files.geometry.json) } : null,
                animation: entity.files.animation ? {
                    sourceName: entity.files.animation.sourceName,
                    json: deepClone(entity.files.animation.json),
                    animationNames: [...entity.files.animation.animationNames],
                } : null,
            };
            clone.animationMappings = { ...entity.animationMappings };
            state.entities.unshift(clone);
            selectEntity(clone.id);
            addMessage(`已复制实体：${entity.baseName || "未命名实体"}`, "info");
            render();
        });

        elements.inspector.querySelector("[data-action='delete-entity']").addEventListener("click", () => {
            state.entities = state.entities.filter((item) => item.id !== entity.id);
            if (state.selectedEntityId === entity.id) {
                state.selectedEntityId = state.entities[0] ? state.entities[0].id : null;
            }
            setStatus(`已删除实体：${entity.baseName || "未命名实体"}`);
            render();
        });
    }

    function renderFileCard(title, type, fileName) {
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">${title}</p>
                        <p class="file-name">${fileName ? escapeHtml(fileName) : "未载入"}</p>
                    </div>
                    <span class="chip ${fileName ? "" : "warn"}">${fileName ? "已就位" : "缺失"}</span>
                </div>
                <div class="file-actions">
                    <button class="button ghost" type="button" data-file-assign="${type}">${fileName ? "替换文件" : "选择文件"}</button>
                    ${fileName ? `<button class="button danger" type="button" data-file-remove="${type}">移除</button>` : ""}
                </div>
            </article>
        `;
    }

    /**
     * 渲染带色盘和透明度的标题颜色输入块，同时保留原始 RGBA 字符串输入。
     */
    function renderTitleColorField(options) {
        return `
            <div class="field">
                <label for="${escapeAttribute(options.idPrefix)}Input">${escapeHtml(options.label)}</label>
                <div class="color-editor">
                    <div class="color-editor-main">
                        <input
                            id="${escapeAttribute(options.idPrefix)}Picker"
                            class="color-picker-input"
                            type="color"
                            value="${escapeAttribute(options.colorState.hex)}"
                            aria-label="${escapeAttribute(options.label)}色盘"
                        >
                        <div class="alpha-editor">
                            <span class="alpha-label">透明度</span>
                            <input
                                id="${escapeAttribute(options.idPrefix)}AlphaInput"
                                class="alpha-input"
                                type="number"
                                min="0"
                                max="1"
                                step="0.01"
                                value="${escapeAttribute(options.colorState.alpha)}"
                                placeholder="1.0"
                            >
                        </div>
                    </div>
                    <input
                        id="${escapeAttribute(options.idPrefix)}Input"
                        type="text"
                        value="${escapeAttribute(options.value)}"
                        placeholder="${escapeAttribute(options.placeholder)}"
                    >
                </div>
                <p class="field-hint">${options.hint}</p>
            </div>
        `;
    }

    function renderOutputPreview() {
        const entity = getSelectedEntity();
        if (!entity) {
            elements.outputPreview.textContent = "选中实体后可查看输出路径。";
            return;
        }

        const name = entity.baseName || "{实体名}";
        const lines = [
            `${ROOT_DIR}/${RESOURCE_ROOT}/textures/entity/${entity.resourceSubdir}/${name}.png`,
            `${ROOT_DIR}/${RESOURCE_ROOT}/models/entity/${entity.resourceSubdir}/${name}.geo.json`,
            `${ROOT_DIR}/${RESOURCE_ROOT}/animations/${entity.resourceSubdir}/${name}.animation.json`,
            `${ROOT_DIR}/${CLIENT_ENTITY_ROOT}/${name}.entity.json`,
            `${ROOT_DIR}/${ENTITY_ROOT}/${name}.entity.json`,
            `${ROOT_DIR}/${SERVER_ROOT}/${name}.yml`,
        ];
        elements.outputPreview.innerHTML = lines.map((line) => `<div class="output-line">${escapeHtml(line)}</div>`).join("");
    }

    function renderMessages() {
        if (!state.messages.length) {
            elements.messageList.innerHTML = '<li class="info">还没有消息。</li>';
            return;
        }
        elements.messageList.innerHTML = state.messages.map((message) => `<li class="${message.level}">${escapeHtml(message.text)}</li>`).join("");
    }

    function syncSelection() {
        if (!state.entities.length) {
            state.selectedEntityId = null;
            return;
        }
        if (!getSelectedEntity()) {
            state.selectedEntityId = state.entities[0].id;
        }
    }

    function selectEntity(entityId) {
        state.selectedEntityId = entityId;
    }

    function getSelectedEntity() {
        return state.entities.find((entity) => entity.id === state.selectedEntityId) || null;
    }

    function getEntityById(entityId) {
        return state.entities.find((entity) => entity.id === entityId) || null;
    }

    function findEntityByBaseName(baseName) {
        if (!baseName) {
            return null;
        }
        return state.entities.find((entity) => entity.baseName === baseName) || null;
    }

    function createEntity(baseName) {
        return {
            id: createId(),
            baseName: baseName || "",
            identifier: baseName ? `netease:${baseName}` : "",
            identifierMode: "auto",
            resourceSubdir: DEFAULT_SUBDIR,
            renderController: DEFAULT_RENDER_CONTROLLER,
            animateController: DEFAULT_CONTROLLER,
            controllerManual: false,
            files: {
                texture: null,
                geometry: null,
                animation: null,
            },
            entityProfile: createDefaultEntityProfile(),
            animationMappings: {},
        };
    }

    /**
     * 创建默认的标题配置，避免多个实体共享同一份引用。
     */
    function createDefaultTitleProfile() {
        return {
            ...DEFAULT_TITLE_PROFILE,
        };
    }

    /**
     * 创建默认的服务端实体 profile。
     */
    function createDefaultEntityProfile() {
        return {
            ...DEFAULT_ENTITY_PROFILE,
            title: createDefaultTitleProfile(),
        };
    }

    function deriveBaseNameFromFile(fileName, type) {
        if (type === "geometry" && fileName.toLowerCase().endsWith(".geo.json")) {
            return fileName.slice(0, -9);
        }
        if (type === "animation" && fileName.toLowerCase().endsWith(".animation.json")) {
            return fileName.slice(0, -15);
        }
        return fileName.replace(/\.[^.]+$/, "");
    }

    function getControllerData() {
        const manifest = window.BA_CONTROLLER_MANIFEST;
        if (manifest && Array.isArray(manifest.animationControllers) && Array.isArray(manifest.renderControllers)) {
            return manifest;
        }
        return getDefaultControllerData();
    }

    function getDefaultControllerData() {
        return {
            generatedAt: null,
            animationControllers: [
                { source: "fallback", name: "controller.animation.entity_idle.default", slots: ["idle"] },
                { source: "fallback", name: "controller.animation.entity_idle_skill1.default", slots: ["skill1", "idle"] },
                { source: "fallback", name: "controller.animation.entity_idle_walk.default", slots: ["idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_normal.default", slots: ["skill1", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill2.default", slots: ["skill2", "skill1", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill3.default", slots: ["skill3", "skill2", "skill1", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill4.default", slots: ["skill3", "skill2", "skill1", "skill4", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill5.default", slots: ["skill3", "skill2", "skill1", "skill5", "skill4", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill6.default", slots: ["skill3", "skill2", "skill1", "skill6", "skill5", "skill4", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill7.default", slots: ["skill3", "skill2", "skill1", "skill7", "skill6", "skill5", "skill4", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.entity_skill8.default", slots: ["skill8", "skill3", "skill2", "skill1", "skill7", "skill6", "skill5", "skill4", "idle", "walk"] },
                { source: "fallback", name: "controller.animation.test_entity.default", slots: ["skill9", "skill8", "skill3", "skill2", "skill1", "skill7", "skill6", "skill5", "skill4", "idle", "skill10", "walk"] },
            ],
            renderControllers: [
                {
                    source: "fallback",
                    name: DEFAULT_RENDER_CONTROLLER,
                    geometryKeys: ["default"],
                    textureKeys: ["default"],
                    materialKeys: ["default"],
                    partVisibilityKeys: ["*"],
                },
            ],
        };
    }

    function buildAnimationControllerPresets() {
        const presetMap = new Map();

        CONTROLLER_DATA.animationControllers.forEach((entry) => {
            if (!presetMap.has(entry.name)) {
                presetMap.set(entry.name, {
                    name: entry.name,
                    slots: [],
                });
            }

            const preset = presetMap.get(entry.name);
            entry.slots.forEach((slotName) => {
                if (!preset.slots.includes(slotName)) {
                    preset.slots.push(slotName);
                }
            });
        });

        return Array.from(presetMap.values())
            .map((preset) => ({
                name: preset.name,
                slots: [...preset.slots].sort(compareSlotNames),
            }))
            .sort(compareControllerNames);
    }

    function buildRenderControllerPresets() {
        const presetMap = new Map();

        CONTROLLER_DATA.renderControllers.forEach((entry) => {
            if (!presetMap.has(entry.name)) {
                presetMap.set(entry.name, {
                    name: entry.name,
                    geometryKeys: [],
                    textureKeys: [],
                    materialKeys: [],
                    partVisibilityKeys: [],
                });
            }

            const preset = presetMap.get(entry.name);
            mergeUniqueValues(preset.geometryKeys, entry.geometryKeys || []);
            mergeUniqueValues(preset.textureKeys, entry.textureKeys || []);
            mergeUniqueValues(preset.materialKeys, entry.materialKeys || []);
            mergeUniqueValues(preset.partVisibilityKeys, entry.partVisibilityKeys || []);
        });

        return Array.from(presetMap.values())
            .map((preset) => ({
                name: preset.name,
                geometryKeys: [...preset.geometryKeys].sort(compareSlotNames),
                textureKeys: [...preset.textureKeys].sort(compareSlotNames),
                materialKeys: [...preset.materialKeys].sort(compareSlotNames),
                partVisibilityKeys: [...preset.partVisibilityKeys].sort(),
            }))
            .sort(compareControllerNames);
    }

    function captureInspectorFocus() {
        const activeElement = document.activeElement;
        if (!activeElement || !elements.inspector.contains(activeElement) || !activeElement.id) {
            return null;
        }
        return {
            id: activeElement.id,
            selectionStart: typeof activeElement.selectionStart === "number" ? activeElement.selectionStart : null,
            selectionEnd: typeof activeElement.selectionEnd === "number" ? activeElement.selectionEnd : null,
        };
    }

    function restoreInspectorFocus(focusState) {
        if (!focusState) {
            return;
        }
        const nextElement = document.getElementById(focusState.id);
        if (!nextElement) {
            return;
        }
        nextElement.focus();
        if (typeof focusState.selectionStart === "number" && typeof nextElement.setSelectionRange === "function") {
            nextElement.setSelectionRange(focusState.selectionStart, focusState.selectionEnd ?? focusState.selectionStart);
        }
    }

    function getControllerSlots(controllerName) {
        const preset = CONTROLLER_PRESETS.find((item) => item.name === controllerName);
        return preset ? [...preset.slots] : [];
    }

    function getRenderControllerPreset(controllerName) {
        return RENDER_CONTROLLER_PRESETS.find((item) => item.name === controllerName) || null;
    }

    function collectRenderBindings(entity) {
        const preset = getRenderControllerPreset(entity.renderController);
        return {
            geometryKeys: preset && preset.geometryKeys.length ? [...preset.geometryKeys] : ["default"],
            textureKeys: preset && preset.textureKeys.length ? [...preset.textureKeys] : ["default"],
            materialKeys: preset ? [...preset.materialKeys] : [],
            partVisibilityKeys: preset ? [...preset.partVisibilityKeys] : [],
        };
    }

    function recommendController(animationNames) {
        const detectedSlots = [...new Set(animationNames.map(inferSlotName).filter(Boolean))];
        if (!detectedSlots.length) {
            return DEFAULT_CONTROLLER;
        }

        const scoredPresets = CONTROLLER_PRESETS.map((preset) => {
            const overlap = preset.slots.filter((slotName) => detectedSlots.includes(slotName)).length;
            const missing = preset.slots.filter((slotName) => !detectedSlots.includes(slotName)).length;
            const uncovered = detectedSlots.filter((slotName) => !preset.slots.includes(slotName)).length;
            return {
                name: preset.name,
                overlap,
                missing,
                uncovered,
                slotCount: preset.slots.length,
            };
        }).filter((item) => item.overlap > 0);

        if (!scoredPresets.length) {
            return DEFAULT_CONTROLLER;
        }

        scoredPresets.sort((left, right) => {
            if (left.uncovered !== right.uncovered) {
                return left.uncovered - right.uncovered;
            }
            if (left.missing !== right.missing) {
                return left.missing - right.missing;
            }
            if (left.overlap !== right.overlap) {
                return right.overlap - left.overlap;
            }
            if (left.slotCount !== right.slotCount) {
                return right.slotCount - left.slotCount;
            }
            return compareControllerNames(left, right);
        });

        return scoredPresets[0].name;
    }

    function buildAnimationMappings(animationFile, slots, previousMappings) {
        const mappings = {};
        if (!animationFile) {
            return mappings;
        }

        const availableNames = [...animationFile.animationNames];
        const used = new Set();
        const previous = previousMappings || {};

        slots.forEach((slotName) => {
            const preferred = previous[slotName];
            if (preferred && availableNames.includes(preferred) && !used.has(preferred)) {
                mappings[slotName] = preferred;
                used.add(preferred);
            }
        });

        slots.forEach((slotName) => {
            if (mappings[slotName]) {
                return;
            }
            const directMatch = availableNames.find((name) => !used.has(name) && inferSlotName(name) === slotName);
            if (directMatch) {
                mappings[slotName] = directMatch;
                used.add(directMatch);
                return;
            }
            const nextUnused = availableNames.find((name) => !used.has(name));
            if (nextUnused) {
                mappings[slotName] = nextUnused;
                used.add(nextUnused);
            }
        });

        return mappings;
    }

    function compareControllerNames(left, right) {
        const leftName = typeof left === "string" ? left : left.name;
        const rightName = typeof right === "string" ? right : right.name;
        const leftRank = leftName.includes(".entity_") ? 0 : 1;
        const rightRank = rightName.includes(".entity_") ? 0 : 1;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        return leftName.localeCompare(rightName);
    }

    function mergeUniqueValues(target, values) {
        values.forEach((value) => {
            if (!target.includes(value)) {
                target.push(value);
            }
        });
    }

    function compareSlotNames(left, right) {
        return getSlotSortValue(left) - getSlotSortValue(right) || left.localeCompare(right);
    }

    function getSlotSortValue(slotName) {
        if (slotName === "idle") {
            return 0;
        }
        if (slotName === "walk") {
            return 1;
        }
        if (/^skill\d+$/i.test(slotName)) {
            return 100 + Number(slotName.replace(/skill/i, ""));
        }
        return 1000;
    }

    function inferSlotName(animationName) {
        const match = animationName.toLowerCase().match(/(?:^|\.)(idle|walk|skill\d+)$/);
        return match ? match[1] : "";
    }

    function createTimestamp() {
        const now = new Date();
        const parts = [
            now.getFullYear(),
            String(now.getMonth() + 1).padStart(2, "0"),
            String(now.getDate()).padStart(2, "0"),
            String(now.getHours()).padStart(2, "0"),
            String(now.getMinutes()).padStart(2, "0"),
            String(now.getSeconds()).padStart(2, "0"),
        ];
        return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
    }

    function downloadBlob(blob, fileName) {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function createId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `entity-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }

    function dedupeErrors(errors) {
        const seen = new Set();
        return errors.filter((error) => {
            const key = `${error.entityId}:${error.message}`;
            if (seen.has(key)) {
                return false;
            }
            seen.add(key);
            return true;
        });
    }

    function addMessage(text, level) {
        state.messages.unshift({ text, level });
        state.messages = state.messages.slice(0, 8);
    }

    /**
     * 绑定标题颜色编辑器，让色盘、透明度和原始 RGBA 文本始终保持同步。
     */
    function bindTitleColorEditor(entity, key, textInput, colorInput, alphaInput) {
        if (!textInput || !colorInput || !alphaInput) {
            return;
        }

        textInput.addEventListener("input", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
            syncTitleColorControls(textInput, colorInput, alphaInput);
        });

        textInput.addEventListener("change", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
            syncTitleColorControls(textInput, colorInput, alphaInput);
            render();
        });

        colorInput.addEventListener("input", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
        });

        colorInput.addEventListener("change", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
            render();
        });

        alphaInput.addEventListener("input", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
        });

        alphaInput.addEventListener("change", (event) => {
            event.target.value = formatColorUnit(parseColorAlpha(event.target.value, 1));
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
            render();
        });

        syncTitleColorControls(textInput, colorInput, alphaInput);
    }

    /**
     * 用当前色盘和透明度生成规范的 RGBA 字符串，并回写到实体配置。
     */
    function applyColorEditorValue(entity, key, textInput, colorInput, alphaInput) {
        const alphaValue = parseColorAlpha(alphaInput.value, 1);
        const colorText = composeNormalizedRgbaColorFromHex(colorInput.value, alphaValue);
        getEntityTitleProfile(entity)[key] = colorText;
        textInput.value = colorText;
        alphaInput.value = formatColorUnit(alphaValue);
    }

    /**
     * 当用户直接编辑 RGBA 文本时，尽量把合法值同步回色盘和透明度控件。
     */
    function syncTitleColorControls(textInput, colorInput, alphaInput) {
        const colorState = getColorEditorState(textInput.value);
        colorInput.value = colorState.hex;
        alphaInput.value = colorState.alpha;
    }

    /**
     * 把 RGBA 文本解析成色盘和透明度控件可直接使用的值。
     */
    function getColorEditorState(value) {
        const parsed = parseNormalizedRgbaColor(value);
        if (!parsed) {
            return {
                hex: "#ffffff",
                alpha: "1.0",
            };
        }

        return {
            hex: rgbUnitsToHex(parsed.red, parsed.green, parsed.blue),
            alpha: formatColorUnit(parsed.alpha),
        };
    }

    /**
     * 解析 0..1 范围内的 RGBA 文本；缺少 alpha 时默认补 1。
     */
    function parseNormalizedRgbaColor(value) {
        if (typeof value !== "string") {
            return null;
        }

        const parts = value.split(",").map((item) => item.trim()).filter(Boolean);
        if (parts.length < 3) {
            return null;
        }

        const red = Number.parseFloat(parts[0]);
        const green = Number.parseFloat(parts[1]);
        const blue = Number.parseFloat(parts[2]);
        const alpha = parts.length >= 4 ? Number.parseFloat(parts[3]) : 1;
        if (![red, green, blue, alpha].every((item) => Number.isFinite(item))) {
            return null;
        }

        return {
            red: clampColorUnit(red),
            green: clampColorUnit(green),
            blue: clampColorUnit(blue),
            alpha: clampColorUnit(alpha),
        };
    }

    /**
     * 把十六进制色值和透明度合成为插件需要的 RGBA 浮点字符串。
     */
    function composeNormalizedRgbaColorFromHex(hexColor, alphaValue) {
        const rgb = hexToRgbUnits(hexColor);
        return [
            formatColorUnit(rgb.red),
            formatColorUnit(rgb.green),
            formatColorUnit(rgb.blue),
            formatColorUnit(alphaValue),
        ].join(",");
    }

    /**
     * 解析透明度输入，保证始终落在 0..1 范围内。
     */
    function parseColorAlpha(value, fallback) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return clampColorUnit(parsed);
    }

    /**
     * 把 0..1 的 RGB 三通道转成 `<input type="color">` 需要的十六进制格式。
     */
    function rgbUnitsToHex(red, green, blue) {
        const channels = [red, green, blue].map((value) => {
            const numeric = Math.round(clampColorUnit(value) * 255);
            return numeric.toString(16).padStart(2, "0");
        });
        return `#${channels.join("")}`;
    }

    /**
     * 把十六进制颜色转成 0..1 范围内的 RGB 浮点值。
     */
    function hexToRgbUnits(hexColor) {
        const normalized = typeof hexColor === "string"
            ? hexColor.trim().replace("#", "")
            : "";
        const hex = normalized.length === 6 ? normalized : "ffffff";
        return {
            red: Number.parseInt(hex.slice(0, 2), 16) / 255,
            green: Number.parseInt(hex.slice(2, 4), 16) / 255,
            blue: Number.parseInt(hex.slice(4, 6), 16) / 255,
        };
    }

    /**
     * 统一裁剪颜色分量，避免超出 0..1 范围。
     */
    function clampColorUnit(value) {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.min(1, Math.max(0, value));
    }

    /**
     * 标题文本比较只看去首尾空白后的结果。
     */
    function normalizeTitleTextValue(value) {
        if (typeof value !== "string") {
            return "";
        }
        return value.trim();
    }

    /**
     * 颜色字段比较时做 RGBA 规范化，避免 `0` 和 `0.0` 被误判成不同。
     */
    function normalizeTitleColorValue(value) {
        const parsed = parseNormalizedRgbaColor(value);
        if (!parsed) {
            return normalizeTitleTextValue(value);
        }
        return [
            formatColorUnit(parsed.red),
            formatColorUnit(parsed.green),
            formatColorUnit(parsed.blue),
            formatColorUnit(parsed.alpha),
        ].join(",");
    }

    /**
     * XYZ 向量字段统一按三个浮点数规范化。
     */
    function normalizeTitleVector3Value(value) {
        return normalizeNumericTupleValue(value, 3, false);
    }

    /**
     * 标题缩放支持单个数字或两个数字，单个数字会展开成 `x,x` 再比较。
     */
    function normalizeTitleBoardScaleValue(value) {
        return normalizeNumericTupleValue(value, 2, true);
    }

    /**
     * 把逗号/空格分隔的数值串规范成稳定格式，供“是否改动”判断使用。
     */
    function normalizeNumericTupleValue(value, size, duplicateSingleValue) {
        if (typeof value !== "string") {
            return "";
        }

        const sanitized = value.trim().replaceAll("(", "").replaceAll(")", "");
        if (!sanitized) {
            return "";
        }

        const parts = sanitized.split(/[\s,]+/).filter(Boolean);
        if (duplicateSingleValue && parts.length === 1) {
            const singleNumber = Number.parseFloat(parts[0]);
            if (!Number.isFinite(singleNumber)) {
                return sanitized;
            }
            const normalized = formatLooseNumber(singleNumber);
            return `${normalized},${normalized}`;
        }

        if (parts.length !== size) {
            return sanitized;
        }

        const numbers = parts.map((part) => Number.parseFloat(part));
        if (!numbers.every((item) => Number.isFinite(item))) {
            return sanitized;
        }

        return numbers.map((item) => formatLooseNumber(item)).join(",");
    }

    /**
     * 非颜色数值不做夹取，只做稳定格式化。
     */
    function formatLooseNumber(value) {
        if (!Number.isFinite(value)) {
            return "0.0";
        }
        let text = value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        if (!text.includes(".")) {
            text += ".0";
        }
        return text;
    }

    /**
     * 颜色分量统一格式化为最多四位小数，同时保留至少一位小数。
     */
    function formatColorUnit(value) {
        const normalized = clampColorUnit(value);
        let text = normalized.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
        if (!text.includes(".")) {
            text += ".0";
        }
        return text;
    }

    function setStatus(text) {
        elements.statusText.textContent = text;
    }

    function typeLabel(type) {
        if (type === "texture") {
            return "贴图";
        }
        if (type === "geometry") {
            return "模型";
        }
        if (type === "animation") {
            return "动作";
        }
        return type;
    }

    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * 确保实体始终持有完整的标题配置，兼容旧数据结构和复制逻辑。
     */
    function getEntityTitleProfile(entity) {
        if (!entity.entityProfile) {
            entity.entityProfile = createDefaultEntityProfile();
        }
        entity.entityProfile.title = {
            ...createDefaultTitleProfile(),
            ...(entity.entityProfile.title || {}),
        };
        return entity.entityProfile.title;
    }

    /**
     * 用 JSON 字符串格式输出 YAML 字符串，足够覆盖当前标题字段的转义需求。
     */
    function quoteYamlString(value) {
        return JSON.stringify(String(value));
    }

    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    function escapeAttribute(value) {
        return escapeHtml(value);
    }
})();
