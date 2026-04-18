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
    const DEFAULT_ANIMATION_BINDING_KEY = "default";
    const SYSTEM_SCALE_CONTROLLER_KEY = "scale";
    const SYSTEM_SCALE_CONTROLLER_NAME = "controller.animation.auto.scale";
    const DEFAULT_ENTITY_PROFILE = {
        width: 1,
        height: 2,
        scale: 1,
        healthBarVisible: true,
        bossBarVisible: false,
        currentHealthCount: 10000,
        force: true,
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
    const SCALE_TRACK_NAME = "scale";
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

            await assignFileToEntity(entity, file, assignment);
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
                await applyRecordToEntity(preferredEntity, detected, null);
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

            await applyRecordToEntity(entity, detected, null);
            selectEntity(entity.id);
            return true;
        } catch (error) {
            addMessage(`导入 ${file.name} 失败：${error.message}`, "error");
            return false;
        }
    }

    async function assignFileToEntity(entity, file, assignment) {
        try {
            const expectedType = assignment && assignment.type;
            const detected = await detectFilePayload(file, expectedType);
            if (!detected) {
                addMessage(`文件 ${file.name} 与目标类型不匹配。`, "warn");
                return;
            }
            await applyRecordToEntity(entity, detected, assignment);
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

    async function applyRecordToEntity(entity, detected, assignment) {
        if (detected.type === "texture") {
            const resources = getTextureResources(entity);
            const existing = assignment && assignment.resourceId
                ? findTextureResource(entity, assignment.resourceId)
                : null;

            if (existing) {
                existing.sourceName = detected.file.name;
                existing.buffer = detected.buffer;
            } else {
                resources.push(createTextureResource({
                    sourceName: detected.file.name,
                    buffer: detected.buffer,
                    resourceKey: suggestResourceKey(resources, detected.file.name, "texture"),
                }));
            }

            addMessage(`已载入贴图：${detected.file.name}`, "info");
            return;
        }

        if (detected.type === "geometry") {
            const resources = getGeometryResources(entity);
            const existing = assignment && assignment.resourceId
                ? findGeometryResource(entity, assignment.resourceId)
                : null;

            if (existing) {
                existing.sourceName = detected.file.name;
                existing.json = detected.json;
            } else {
                resources.push(createGeometryResource({
                    sourceName: detected.file.name,
                    json: detected.json,
                    resourceKey: suggestResourceKey(resources, detected.file.name, "geometry"),
                }));
            }

            addMessage(`已载入模型：${detected.file.name}`, "info");
            return;
        }

        if (detected.type === "animation") {
            entity.files.animation = {
                sourceName: detected.file.name,
                json: detected.json,
                animationNames: detected.animationNames,
            };
            const animationBindings = getAnimationControllerBindings(entity);
            if (animationBindings.length === 1
                && animationBindings[0].key === DEFAULT_ANIMATION_BINDING_KEY
                && animationBindings[0].controller === DEFAULT_CONTROLLER
                && !hasAnyAnimationMappings(animationBindings[0])) {
                animationBindings[0].controller = recommendController(detected.animationNames);
            }
            animationBindings.forEach((binding) => {
                binding.animationMappings = buildAnimationMappings(
                    entity.files.animation,
                    getBindingSlotNames(binding),
                    binding.animationMappings
                );
            });
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
            const animationPath = `${ROOT_DIR}/${RESOURCE_ROOT}/animations/${entity.resourceSubdir}/${entity.baseName}.animation.json`;
            const clientEntityPath = `${ROOT_DIR}/${CLIENT_ENTITY_ROOT}/${entity.baseName}.entity.json`;
            const entityPath = `${ROOT_DIR}/${ENTITY_ROOT}/${entity.baseName}.entity.json`;
            const ymlPath = `${ROOT_DIR}/${SERVER_ROOT}/${entity.baseName}.yml`;

            normalized.textureFiles.forEach((textureFile) => {
                zip.file(textureFile.path, textureFile.buffer);
            });
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
            const entityProfile = getEntityProfile(entity);
            const renderControllers = getRenderControllers(entity);
            const animationBindings = getAnimationControllerBindings(entity);
            const mergedAnimationData = getMergedAnimationEntries(entity);
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
            if (!Number.isFinite(entityProfile.width) || entityProfile.width <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的碰撞箱宽度必须大于 0。` });
            }
            if (!Number.isFinite(entityProfile.height) || entityProfile.height <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的碰撞箱高度必须大于 0。` });
            }
            if (!Number.isFinite(entityProfile.scale) || entityProfile.scale <= 0) {
                errors.push({ entityId: entity.id, message: `${name} 的模型缩放必须大于 0。` });
            }
            if (!Number.isInteger(entityProfile.currentHealthCount) || entityProfile.currentHealthCount < 100) {
                errors.push({ entityId: entity.id, message: `${name} 的当前血条段数必须是大于等于 100 的整数。` });
            }
            if (!getTextureResources(entity).length) {
                errors.push({ entityId: entity.id, message: `${name} 缺少贴图文件。` });
            }
            if (!getGeometryResources(entity).length) {
                errors.push({ entityId: entity.id, message: `${name} 缺少模型文件。` });
            }
            if (!entity.files.animation) {
                errors.push({ entityId: entity.id, message: `${name} 缺少动作文件。` });
            }
            renderControllers.forEach((renderController, index) => {
                if (!renderController.controller || !String(renderController.controller).trim()) {
                    errors.push({ entityId: entity.id, message: `${name} 的第 ${index + 1} 个渲染控制器不能为空。` });
                }
            });
            const bindingKeys = new Set();
            animationBindings.forEach((binding, index) => {
                const bindingKey = String(binding.key || "").trim();
                if (!bindingKey) {
                    errors.push({ entityId: entity.id, message: `${name} 的第 ${index + 1} 个动画控制器绑定 key 不能为空。` });
                    return;
                }
                if (bindingKey === SYSTEM_SCALE_CONTROLLER_KEY) {
                    errors.push({ entityId: entity.id, message: `${name} 的动画控制器绑定 key 不能使用保留字 scale。` });
                }
                if (bindingKeys.has(bindingKey)) {
                    errors.push({ entityId: entity.id, message: `${name} 的动画控制器绑定 key ${bindingKey} 重复。` });
                }
                bindingKeys.add(bindingKey);
                if (!binding.controller || !String(binding.controller).trim()) {
                    errors.push({ entityId: entity.id, message: `${name} 的动画控制器绑定 ${bindingKey} 未选择控制器。` });
                }
            });
            mergedAnimationData.conflicts.forEach((conflict) => {
                errors.push({
                    entityId: entity.id,
                    message: `${name} 的动作 key ${conflict.key} 在控制器 ${conflict.firstBindingKey} 和 ${conflict.secondBindingKey} 上映射到了不同动作。`,
                });
            });
            if (entity.files.animation && !mergedAnimationData.entries.length) {
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
        const textureFiles = buildTextureExportFiles(entity);

        return {
            geometryJson,
            animationJson,
            entityJson,
            clientEntityJson,
            textureFiles,
            ymlText: createYmlText(entity, animateList, renderBindings),
        };
    }

    function normalizeGeometryJson(entity) {
        const geometryResources = getGeometryResources(entity);
        const mergedGeometries = [];
        let formatVersion = "1.12.0";

        geometryResources.forEach((resource) => {
            if (!resource.json || typeof resource.json !== "object") {
                return;
            }

            if (resource.json.format_version) {
                formatVersion = resource.json.format_version;
            }

            const geometries = Array.isArray(resource.json["minecraft:geometry"])
                ? deepClone(resource.json["minecraft:geometry"])
                : [];

            geometries.forEach((item, index) => {
                item.description = item.description || {};
                item.description.identifier = buildGeometryResourceIdentifier(entity, resource, index);
                mergedGeometries.push(item);
            });
        });

        return {
            format_version: formatVersion,
            "minecraft:geometry": mergedGeometries,
        };
    }

    function normalizeAnimationJson(entity) {
        const baseJson = deepClone(entity.files.animation.json);
        const renamedAnimations = {};
        const sourceAnimations = entity.files.animation.json.animations || {};

        createAnimateList(entity).forEach((entry) => {
            if (!entry.sourceName || !sourceAnimations[entry.sourceName]) {
                return;
            }
            renamedAnimations[entry.name] = deepClone(sourceAnimations[entry.sourceName]);
        });

        baseJson.animations = renamedAnimations;
        if (!baseJson.format_version) {
            baseJson.format_version = "1.8.0";
        }
        padScaleTracksToLinearTail(baseJson);
        return baseJson;
    }

    /**
     * 只给缩放轨道补一个“线性末尾帧”，避免把 pre/post 这类复杂关键帧整块复制到结尾。
     */
    function padScaleTracksToLinearTail(animationJson) {
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

                const channel = boneBody[SCALE_TRACK_NAME];
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

                const linearFrameValue = extractLinearScaleFrameValue(channel[lastFrame.key]);
                if (!linearFrameValue) {
                    return;
                }

                const finalKey = formatAnimationTimeKey(animationLength, frames.map((frame) => frame.key));
                channel[finalKey] = linearFrameValue;
            });
        });
    }

    /**
     * 把缩放关键帧统一提取成普通数组帧；对象帧优先取 post，再退回 pre。
     */
    function extractLinearScaleFrameValue(frameValue) {
        if (Array.isArray(frameValue)) {
            return deepClone(frameValue);
        }
        if (!frameValue || typeof frameValue !== "object") {
            return null;
        }
        if (Array.isArray(frameValue.post)) {
            return deepClone(frameValue.post);
        }
        if (Array.isArray(frameValue.pre)) {
            return deepClone(frameValue.pre);
        }
        return null;
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
            [SYSTEM_SCALE_CONTROLLER_KEY]: "animation.entity.auto.scale",
        };
        animateList.forEach((item) => {
            animations[item.key] = item.name;
        });

        const materials = {};
        (renderBindings.materialKeys.length ? renderBindings.materialKeys : ["default"]).forEach((key) => {
            materials[key] = "entity_alphatest";
        });

        const textures = {};
        renderBindings.textureEntries.forEach((entry) => {
            textures[entry.key] = entry.path;
        });

        const geometry = {};
        renderBindings.geometryEntries.forEach((entry) => {
            geometry[entry.key] = entry.identifier;
        });

        const animationControllerList = getAnimationControllerBindings(entity)
            .map((binding) => ({
                [binding.key]: binding.controller,
            }));
        animationControllerList.push({
            [SYSTEM_SCALE_CONTROLLER_KEY]: SYSTEM_SCALE_CONTROLLER_NAME,
        });

        const renderControllerList = getRenderControllers(entity)
            .map((binding) => binding.controller)
            .filter(Boolean);

        return {
            format_version: "1.8.0",
            "minecraft:client_entity": {
                description: {
                    identifier: entity.identifier,
                    materials,
                    textures,
                    geometry,
                    animations,
                    animation_controllers: animationControllerList,
                    render_controllers: renderControllerList,
                },
            },
        };
    }

    function createAnimateList(entity) {
        return getMergedAnimationEntries(entity).entries.map((entry) => ({
            key: entry.key,
            name: entry.name,
            sourceName: entry.sourceName,
        }));
    }

    function createYmlText(entity, animateList, renderBindings) {
        const lines = [
            `${entity.baseName}:`,
            `  entityIdentifier: ${entity.identifier}`,
            "  geometry:",
        ];

        renderBindings.geometryEntries.forEach((entry) => {
            lines.push(`  - key: ${entry.key}`);
            lines.push(`    name: ${entry.identifier}`);
        });

        lines.push("  texture:");
        renderBindings.textureEntries.forEach((entry) => {
            lines.push(`  - key: ${entry.key}`);
            lines.push(`    name: ${entry.path}`);
        });

        lines.push("  render:");
        getRenderControllers(entity).forEach((binding) => {
            lines.push(`  - controller: ${binding.controller}`);
            lines.push(`    condition: ${quoteYamlString(binding.condition || "")}`);
        });
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
        getAnimationControllerBindings(entity).forEach((binding) => {
            lines.push(`  - key: ${binding.key}`);
            lines.push(`    name: ${binding.controller}`);
        });

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
        const entityProfile = getEntityProfile(entity);
        const titleProfile = getEntityTitleProfile(entity);
        const changedTitleEntries = getChangedTitleProfileEntries(titleProfile);
        const changedEntityProfileEntries = getChangedExtraEntityProfileEntries(entity);

        if (hasCustomNumericEntityProfile(entity)) {
            lines.push("    # 碰撞箱");
            lines.push(`    width: ${entityProfile.width}`);
            lines.push(`    height: ${entityProfile.height}`);
            lines.push("    # 模型缩放");
            lines.push(`    scale: ${entityProfile.scale}`);
        }

        if (changedEntityProfileEntries.length) {
            lines.push("    # 服务端显示与强制同步");
            changedEntityProfileEntries.forEach((entry) => {
                lines.push(`    ${entry.key}: ${entry.value}`);
            });
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
        const entityProfile = getEntityProfile(entity);
        return entityProfile.width !== DEFAULT_ENTITY_PROFILE.width
            || entityProfile.height !== DEFAULT_ENTITY_PROFILE.height
            || entityProfile.scale !== DEFAULT_ENTITY_PROFILE.scale;
    }

    /**
     * 只导出偏离默认值的额外服务端 profile 字段，保持 yml 干净。
     */
    function getChangedExtraEntityProfileEntries(entity) {
        const entityProfile = getEntityProfile(entity);
        const entries = [];
        if (entityProfile.healthBarVisible !== DEFAULT_ENTITY_PROFILE.healthBarVisible) {
            entries.push({ key: "healthBarVisible", value: String(Boolean(entityProfile.healthBarVisible)) });
        }
        if (entityProfile.bossBarVisible !== DEFAULT_ENTITY_PROFILE.bossBarVisible) {
            entries.push({ key: "bossBarVisible", value: String(Boolean(entityProfile.bossBarVisible)) });
        }
        if (entityProfile.currentHealthCount !== DEFAULT_ENTITY_PROFILE.currentHealthCount) {
            entries.push({ key: "currentHealthCount", value: String(entityProfile.currentHealthCount) });
        }
        if (entityProfile.force !== DEFAULT_ENTITY_PROFILE.force) {
            entries.push({ key: "force", value: String(Boolean(entityProfile.force)) });
        }
        return entries;
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
     * 解析整数 profile 字段，并在回填时强制满足最小值要求。
     */
    function parseEntityProfileIntegerValue(value, fallback, minValue) {
        const parsed = Number.parseInt(value, 10);
        if (!Number.isFinite(parsed)) {
            return fallback;
        }
        return Math.max(minValue, parsed);
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
     * 绑定整数型实体 profile 输入框，保证值始终不低于配置要求。
     */
    function bindEntityProfileIntegerInput(input, entity, key, fallback, minValue) {
        input.addEventListener("input", (event) => {
            entity.entityProfile[key] = parseEntityProfileIntegerValue(event.target.value, fallback, minValue);
        });

        input.addEventListener("change", (event) => {
            entity.entityProfile[key] = parseEntityProfileIntegerValue(event.target.value, fallback, minValue);
            event.target.value = String(entity.entityProfile[key]);
            render();
        });
    }

    /**
     * 绑定布尔型实体 profile 下拉框，直接同步到当前实体。
     */
    function bindEntityProfileBooleanSelect(select, entity, key) {
        select.addEventListener("change", (event) => {
            entity.entityProfile[key] = event.target.value === "true";
            renderOutputPreview();
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
            const textureCount = getTextureResources(entity).length;
            const geometryCount = getGeometryResources(entity).length;
            const chips = [
                textureCount ? `贴图${textureCount}` : null,
                geometryCount ? `模型${geometryCount}` : null,
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
        const entityProfile = getEntityProfile(entity);
        const renderControllerBindings = getRenderControllers(entity);
        const animationControllerBindings = getAnimationControllerBindings(entity);
        const textureResources = getTextureResources(entity);
        const geometryResources = getGeometryResources(entity);
        const renderBindings = collectRenderBindings(entity);
        const mergedAnimationData = getMergedAnimationEntries(entity);
        const animationSlotNames = collectAnimationSlotNames(entity);
        const titleProfile = getEntityTitleProfile(entity);
        const titleTextColorState = getColorEditorState(titleProfile.textColor);
        const titleBackgroundColorState = getColorEditorState(titleProfile.backgroundColor);
        const titleDepthTestValue = titleProfile.depthTest === true
            ? "true"
            : titleProfile.depthTest === false
                ? "false"
                : "";
        const availableAnimations = entity.files.animation ? entity.files.animation.animationNames : [];
        const usedAnimationNames = getUsedAnimationSourceNames(entity);
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
                </div>
            </section>

            <section class="section-card">
                <div class="detail-actions">
                    <h3>渲染控制器</h3>
                    <button class="button ghost" type="button" data-action="add-render-controller">新增额外渲染控制器</button>
                </div>
                <div class="file-stack">
                    ${renderControllerBindings.map((binding, index) => renderRenderControllerBindingCard(entity, binding, index, renderControllerBindings.length, geometryResources, textureResources)).join("")}
                </div>
            </section>

            <section class="section-card">
                <div class="detail-actions">
                    <h3>动画控制器绑定</h3>
                    <button class="button ghost" type="button" data-action="add-animation-controller">新增额外动画控制器</button>
                </div>
                <p class="field-hint">系统会固定追加 <code>${escapeHtml(SYSTEM_SCALE_CONTROLLER_KEY)} -&gt; ${escapeHtml(SYSTEM_SCALE_CONTROLLER_NAME)}</code>，该控制器不会在这里开放编辑。</p>
                <article class="file-card">
                    <div class="file-card-header">
                        <div>
                            <p class="file-title">系统内置控制器</p>
                            <p class="file-name">${escapeHtml(SYSTEM_SCALE_CONTROLLER_KEY)} -> ${escapeHtml(SYSTEM_SCALE_CONTROLLER_NAME)}</p>
                        </div>
                        <span class="chip muted">只读</span>
                    </div>
                </article>
                ${mergedAnimationData.conflicts.length ? `
                    <div class="chip-row">
                        ${mergedAnimationData.conflicts.map((conflict) => `<span class="chip warn">动作 key ${escapeHtml(conflict.key)} 在 ${escapeHtml(conflict.firstBindingKey)} / ${escapeHtml(conflict.secondBindingKey)} 上冲突</span>`).join("")}
                    </div>
                ` : ""}
                <div class="file-stack">
                    ${animationControllerBindings.map((binding, index) => renderAnimationControllerBindingCard(entity, binding, index, animationControllerBindings.length, availableAnimations)).join("")}
                </div>
            </section>

            <section class="section-card">
                <h3>服务端实体 Profile</h3>
                    <div class="slot-grid">
                    <div class="field">
                                                    <label for="profileWidthInput">碰撞箱宽度</label>
                                                    <input id="profileWidthInput" type="number" min="0.01" step="any" value="${escapeAttribute(entityProfile.width)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，支持小数，仅在服务端插件配置中使用。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileHeightInput">碰撞箱高度</label>
                                                    <input id="profileHeightInput" type="number" min="0.01" step="any" value="${escapeAttribute(entityProfile.height)}">
                                                    <p class="field-hint">默认值为 <code>2</code>，支持小数，仅在服务端插件配置中使用。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileScaleInput">模型缩放</label>
                                                    <input id="profileScaleInput" type="number" min="0.01" step="any" value="${escapeAttribute(entityProfile.scale)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，支持小数。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileHealthBarVisibleSelect">显示血条</label>
                                                    <select id="profileHealthBarVisibleSelect">
                                                        <option value="true" ${entityProfile.healthBarVisible ? "selected" : ""}>true</option>
                                                        <option value="false" ${!entityProfile.healthBarVisible ? "selected" : ""}>false</option>
                                                    </select>
                                                    <p class="field-hint">默认值为 <code>true</code>，未改动时不会导出。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileBossBarVisibleSelect">显示 Boss 血条</label>
                                                    <select id="profileBossBarVisibleSelect">
                                                        <option value="true" ${entityProfile.bossBarVisible ? "selected" : ""}>true</option>
                                                        <option value="false" ${!entityProfile.bossBarVisible ? "selected" : ""}>false</option>
                                                    </select>
                                                    <p class="field-hint">默认值为 <code>false</code>，未改动时不会导出。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileCurrentHealthCountInput">当前血条段数</label>
                                                    <input id="profileCurrentHealthCountInput" type="number" min="100" step="1" value="${escapeAttribute(entityProfile.currentHealthCount)}">
                                                    <p class="field-hint">默认值为 <code>10000</code>，必须是大于等于 <code>100</code> 的整数。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileForceSelect">强制同步 Identifier</label>
                                                    <select id="profileForceSelect">
                                                        <option value="true" ${entityProfile.force ? "selected" : ""}>true</option>
                                                        <option value="false" ${!entityProfile.force ? "selected" : ""}>false</option>
                                                    </select>
                                                    <p class="field-hint">默认值为 <code>true</code>，未改动时不会导出。</p>
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
                <div class="detail-actions">
                    <h3>贴图资源</h3>
                    <button class="button ghost" type="button" data-action="add-texture-resource">新增贴图资源</button>
                </div>
                <div class="file-stack">
                    ${textureResources.length
                        ? textureResources.map((resource) => renderResourceFileCard("贴图资源", "texture", resource, entity)).join("")
                        : '<p class="empty-state">还没有贴图资源。</p>'}
                </div>
            </section>

            <section class="section-card">
                <div class="detail-actions">
                    <h3>模型资源</h3>
                    <button class="button ghost" type="button" data-action="add-geometry-resource">新增模型资源</button>
                </div>
                <div class="file-stack">
                    ${geometryResources.length
                        ? geometryResources.map((resource) => renderResourceFileCard("模型资源", "geometry", resource, entity)).join("")
                        : '<p class="empty-state">还没有模型资源。</p>'}
                </div>
            </section>

            <section class="section-card">
                <h3>动作文件</h3>
                <div class="file-stack">
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
                            ${animationSlotNames.length ? animationSlotNames.map((slotName) => `<span class="chip">${escapeHtml(slotName)}</span>`).join("") : '<span class="chip muted">当前控制器没有动画 key</span>'}
                        </div>
                    </div>
                </div>
            </section>

            <section class="section-card">
                <h3>未使用动作</h3>
                ${unusedAnimations.length ? `<div class="chip-row">${unusedAnimations.map((name) => `<span class="chip muted">${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="field-hint">当前动作文件中的动画块都已被控制器映射使用。</p>'}
            </section>

        `;

        bindInspectorEvents(entity);
    }

    function bindInspectorEvents(entity) {
        const baseNameInput = document.getElementById("baseNameInput");
        const identifierInput = document.getElementById("identifierInput");
        const resourceSubdirInput = document.getElementById("resourceSubdirInput");
        const profileWidthInput = document.getElementById("profileWidthInput");
        const profileHeightInput = document.getElementById("profileHeightInput");
        const profileScaleInput = document.getElementById("profileScaleInput");
        const profileHealthBarVisibleSelect = document.getElementById("profileHealthBarVisibleSelect");
        const profileBossBarVisibleSelect = document.getElementById("profileBossBarVisibleSelect");
        const profileCurrentHealthCountInput = document.getElementById("profileCurrentHealthCountInput");
        const profileForceSelect = document.getElementById("profileForceSelect");
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

        bindEntityProfileInput(profileWidthInput, entity, "width", DEFAULT_ENTITY_PROFILE.width);
        bindEntityProfileInput(profileHeightInput, entity, "height", DEFAULT_ENTITY_PROFILE.height);
        bindEntityProfileInput(profileScaleInput, entity, "scale", DEFAULT_ENTITY_PROFILE.scale);
        bindEntityProfileBooleanSelect(profileHealthBarVisibleSelect, entity, "healthBarVisible");
        bindEntityProfileBooleanSelect(profileBossBarVisibleSelect, entity, "bossBarVisible");
        bindEntityProfileIntegerInput(profileCurrentHealthCountInput, entity, "currentHealthCount", DEFAULT_ENTITY_PROFILE.currentHealthCount, 100);
        bindEntityProfileBooleanSelect(profileForceSelect, entity, "force");
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
                    getAnimationControllerBindings(entity).forEach((binding) => {
                        binding.animationMappings = {};
                    });
                }
                setStatus(`已移除 ${typeLabel(type)}。`);
                render();
            });
        });

        elements.inspector.querySelector("[data-action='add-texture-resource']").addEventListener("click", () => {
            state.pendingAssignment = { entityId: entity.id, type: "texture" };
            elements.assignInput.accept = ".png";
            elements.assignInput.click();
        });

        elements.inspector.querySelector("[data-action='add-geometry-resource']").addEventListener("click", () => {
            state.pendingAssignment = { entityId: entity.id, type: "geometry" };
            elements.assignInput.accept = ".json";
            elements.assignInput.click();
        });

        elements.inspector.querySelectorAll("[data-resource-assign]").forEach((button) => {
            button.addEventListener("click", () => {
                const type = button.dataset.resourceAssign;
                state.pendingAssignment = {
                    entityId: entity.id,
                    type,
                    resourceId: button.dataset.resourceId,
                };
                elements.assignInput.accept = type === "texture" ? ".png" : ".json";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-resource-remove]").forEach((button) => {
            button.addEventListener("click", () => {
                const type = button.dataset.resourceRemove;
                const resourceId = button.dataset.resourceId;
                if (type === "texture") {
                    entity.files.textures = getTextureResources(entity).filter((resource) => resource.id !== resourceId);
                } else if (type === "geometry") {
                    entity.files.geometries = getGeometryResources(entity).filter((resource) => resource.id !== resourceId);
                }
                setStatus(`已移除 ${typeLabel(type)}资源。`);
                render();
            });
        });

        const renderBindings = getRenderControllers(entity);
        const animationBindings = getAnimationControllerBindings(entity);

        elements.inspector.querySelector("[data-action='add-render-controller']").addEventListener("click", () => {
            renderBindings.push(createRenderControllerBinding());
            render();
        });

        elements.inspector.querySelector("[data-action='add-animation-controller']").addEventListener("click", () => {
            const recommendedController = entity.files.animation
                ? recommendController(entity.files.animation.animationNames)
                : DEFAULT_CONTROLLER;
            animationBindings.push(createAnimationControllerBinding({
                key: suggestNextAnimationBindingKey(animationBindings),
                controller: recommendedController,
                animationMappings: buildAnimationMappings(entity.files.animation, getControllerSlots(recommendedController), {}),
            }));
            render();
        });

        elements.inspector.querySelectorAll("[data-render-binding-controller]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingController);
                if (!binding) {
                    return;
                }
                binding.controller = event.target.value;
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-render-binding-condition]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingCondition);
                if (!binding) {
                    return;
                }
                binding.condition = event.target.value;
            });

            input.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingCondition);
                if (!binding) {
                    return;
                }
                binding.condition = event.target.value;
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-action='remove-render-controller']").forEach((button) => {
            button.addEventListener("click", () => {
                const bindingId = button.dataset.renderBindingId;
                entity.renderControllers = getRenderControllers(entity).filter((binding) => binding.id !== bindingId);
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-render-binding-mapping-key]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingMappingKey);
                if (!binding) {
                    return;
                }
                const mappingType = event.target.dataset.renderBindingMappingType;
                const originKey = event.target.dataset.renderBindingMappingOriginKey;
                const nextKey = event.target.value;
                const targetMappings = mappingType === "geometry" ? binding.geometryMappings : binding.textureMappings;
                if (originKey !== nextKey) {
                    targetMappings[nextKey] = targetMappings[originKey] || "";
                    delete targetMappings[originKey];
                }
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-render-binding-resource-id]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingResourceId);
                if (!binding) {
                    return;
                }
                const mappingType = event.target.dataset.renderBindingResourceType;
                const mappingKey = event.target.dataset.renderBindingResourceKey;
                const targetMappings = mappingType === "geometry" ? binding.geometryMappings : binding.textureMappings;
                targetMappings[mappingKey] = event.target.value;
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-key]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingKey);
                if (!binding) {
                    return;
                }
                binding.key = event.target.value;
            });

            input.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingKey);
                if (!binding) {
                    return;
                }
                const nextKey = event.target.value.trim();
                if (nextKey === SYSTEM_SCALE_CONTROLLER_KEY) {
                    binding.key = suggestNextAnimationBindingKey(
                        getAnimationControllerBindings(entity).filter((item) => item.id !== binding.id)
                    );
                    addMessage("scale 是系统内置动画控制器 key，业务控制器不能占用。", "warn");
                    render();
                    return;
                }
                binding.key = nextKey;
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-controller]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingController);
                if (!binding) {
                    return;
                }
                binding.controller = event.target.value;
                binding.animationMappings = buildAnimationMappings(entity.files.animation, getControllerSlots(binding.controller), binding.animationMappings);
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-action='remove-animation-controller']").forEach((button) => {
            button.addEventListener("click", () => {
                const bindingId = button.dataset.animationBindingId;
                entity.animationControllerBindings = getAnimationControllerBindings(entity).filter((binding) => binding.id !== bindingId);
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-slot-binding-id]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationSlotBindingId);
                if (!binding) {
                    return;
                }
                binding.animationMappings[event.target.dataset.slotName] = event.target.value;
                render();
            });
        });

        elements.inspector.querySelector("[data-action='duplicate-entity']").addEventListener("click", () => {
            const clone = createEntity(entity.baseName);
            const entityProfile = getEntityProfile(entity);
            const oldTextureIdToNewId = {};
            const oldGeometryIdToNewId = {};
            clone.identifier = entity.identifier;
            clone.identifierMode = entity.identifierMode;
            clone.resourceSubdir = entity.resourceSubdir;
            clone.animationControllerBindings = getAnimationControllerBindings(entity).map((binding) => ({
                id: createId(),
                key: binding.key,
                controller: binding.controller,
                animationMappings: { ...(binding.animationMappings || {}) },
            }));
            clone.entityProfile = {
                width: entityProfile.width,
                height: entityProfile.height,
                scale: entityProfile.scale,
                healthBarVisible: entityProfile.healthBarVisible,
                bossBarVisible: entityProfile.bossBarVisible,
                currentHealthCount: entityProfile.currentHealthCount,
                force: entityProfile.force,
                title: { ...getEntityTitleProfile(entity) },
            };
            clone.files = {
                textures: getTextureResources(entity).map((resource) => {
                    const nextId = createId();
                    oldTextureIdToNewId[resource.id] = nextId;
                    return {
                        id: nextId,
                        resourceKey: resource.resourceKey,
                        sourceName: resource.sourceName,
                        buffer: resource.buffer,
                    };
                }),
                geometries: getGeometryResources(entity).map((resource) => {
                    const nextId = createId();
                    oldGeometryIdToNewId[resource.id] = nextId;
                    return {
                        id: nextId,
                        resourceKey: resource.resourceKey,
                        sourceName: resource.sourceName,
                        json: deepClone(resource.json),
                    };
                }),
                texture: null,
                geometry: null,
                animation: entity.files.animation ? {
                    sourceName: entity.files.animation.sourceName,
                    json: deepClone(entity.files.animation.json),
                    animationNames: [...entity.files.animation.animationNames],
                } : null,
            };
            clone.renderControllers = getRenderControllers(entity).map((binding) => ({
                id: createId(),
                controller: binding.controller,
                condition: binding.condition,
                geometryMappings: Object.fromEntries(Object.entries(binding.geometryMappings || {}).map(([key, value]) => [key, oldGeometryIdToNewId[value] || ""])),
                textureMappings: Object.fromEntries(Object.entries(binding.textureMappings || {}).map(([key, value]) => [key, oldTextureIdToNewId[value] || ""])),
            }));
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
     * 渲染单个资源文件卡片；贴图和模型都走这一套。
     */
    function renderResourceFileCard(title, type, resource, entity) {
        const exportTarget = type === "geometry"
            ? buildGeometryResourceIdentifier(entity, resource, 0)
            : `${buildTextureResourcePath(entity, resource)}.png`;
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">${escapeHtml(title)}</p>
                        <p class="file-name">${escapeHtml(resource.sourceName || "未命名资源")}</p>
                        <p class="field-hint">资源 key：<code>${escapeHtml(resource.resourceKey)}</code></p>
                        <p class="field-hint">导出目标：<code>${escapeHtml(exportTarget)}</code></p>
                    </div>
                    <span class="chip">${escapeHtml(resource.resourceKey)}</span>
                </div>
                <div class="file-actions">
                    <button class="button ghost" type="button" data-resource-assign="${type}" data-resource-id="${escapeAttribute(resource.id)}">替换文件</button>
                    <button class="button danger" type="button" data-resource-remove="${type}" data-resource-id="${escapeAttribute(resource.id)}">移除</button>
                </div>
            </article>
        `;
    }

    /**
     * 渲染单个渲染控制器绑定卡片。
     */
    function renderRenderControllerBindingCard(entity, binding, index, total, geometryResources, textureResources) {
        const currentPreset = getRenderControllerPreset(binding.controller);
        const hasCurrentPreset = RENDER_CONTROLLER_PRESETS.some((preset) => preset.name === binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        const controllerDescription = currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : "";
        const geometryEntries = getRenderBindingMappingEntries(entity, binding, "geometry", geometryResources);
        const textureEntries = getRenderBindingMappingEntries(entity, binding, "texture", textureResources);
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">渲染控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(controllerDisplayName)}</p>
                        ${controllerDescription}
                    </div>
                    ${total > 1 ? `<button class="button danger" type="button" data-action="remove-render-controller" data-render-binding-id="${escapeAttribute(binding.id)}">移除</button>` : ""}
                </div>
                <div class="form-grid">
                    <div class="field field-wide">
                        <label for="renderBindingController-${escapeAttribute(binding.id)}">控制器</label>
                        <select id="renderBindingController-${escapeAttribute(binding.id)}" data-render-binding-controller="${escapeAttribute(binding.id)}">
                            ${binding.controller && !hasCurrentPreset ? `<option value="${escapeAttribute(binding.controller)}" selected>${escapeHtml(binding.controller)}（未收录）</option>` : ""}
                            ${RENDER_CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === binding.controller ? "selected" : ""}>${escapeHtml(formatControllerOptionLabel(preset, preset.name))}</option>`).join("")}
                        </select>
                        ${currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : '<p class="field-hint">未找到该控制器的中文说明。</p>'}
                    </div>
                    <div class="field">
                        <label for="renderBindingCondition-${escapeAttribute(binding.id)}">条件</label>
                        <input id="renderBindingCondition-${escapeAttribute(binding.id)}" type="text" value="${escapeAttribute(binding.condition || "")}" data-render-binding-condition="${escapeAttribute(binding.id)}" placeholder="">
                        <p class="field-hint">导出到 yml 的 <code>condition</code> 字段。</p>
                    </div>
                </div>
                ${renderRenderBindingMappingSection(binding, "geometry", geometryEntries, geometryResources)}
                ${renderRenderBindingMappingSection(binding, "texture", textureEntries, textureResources)}
            </article>
        `;
    }

    /**
     * 渲染单个渲染控制器卡片内的 geometry / texture 映射区。
     */
    function renderRenderBindingMappingSection(binding, type, entries, resources) {
        const title = type === "geometry" ? "Geometry 映射" : "Texture 映射";
        const prefix = type === "geometry" ? "Geometry" : "Texture";
        const emptyText = type === "geometry" ? "当前没有模型资源，先去下方资源区导入。" : "当前没有贴图资源，先去下方资源区导入。";
        const resourceHint = type === "geometry" ? "模型资源" : "贴图资源";
        return `
            <div class="slot-grid">
                ${entries.length ? entries.map((entry) => `
                    <div class="slot-card">
                        <h4>${escapeHtml(title)}</h4>
                        <label for="renderBinding-${escapeAttribute(type)}-key-${escapeAttribute(binding.id)}-${escapeAttribute(entry.key)}">${escapeHtml(prefix)} Key</label>
                        <select id="renderBinding-${escapeAttribute(type)}-key-${escapeAttribute(binding.id)}-${escapeAttribute(entry.key)}" data-render-binding-mapping-key="${escapeAttribute(binding.id)}" data-render-binding-mapping-type="${escapeAttribute(type)}" data-render-binding-mapping-origin-key="${escapeAttribute(entry.key)}">
                            ${entry.availableKeys.map((key) => `<option value="${escapeAttribute(key)}" ${key === entry.key ? "selected" : ""}>${escapeHtml(prefix)}.${escapeHtml(key)}</option>`).join("")}
                        </select>
                        <label for="renderBinding-${escapeAttribute(type)}-resource-${escapeAttribute(binding.id)}-${escapeAttribute(entry.key)}">${escapeHtml(resourceHint)}</label>
                        <select id="renderBinding-${escapeAttribute(type)}-resource-${escapeAttribute(binding.id)}-${escapeAttribute(entry.key)}" data-render-binding-resource-id="${escapeAttribute(binding.id)}" data-render-binding-resource-type="${escapeAttribute(type)}" data-render-binding-resource-key="${escapeAttribute(entry.key)}" ${resources.length ? "" : "disabled"}>
                            ${resources.length
                                ? resources.map((resource) => `<option value="${escapeAttribute(resource.id)}" ${resource.id === entry.resourceId ? "selected" : ""}>${escapeHtml(resource.resourceKey)} · ${escapeHtml(resource.sourceName || "未命名资源")}</option>`).join("")
                                : '<option value="">暂无可用资源</option>'}
                        </select>
                        <p>${escapeHtml(entry.previewText)}</p>
                    </div>
                `).join("") : `<div class="slot-card"><h4>${escapeHtml(title)}</h4><p>${escapeHtml(type === "geometry" ? "当前控制器没有 geometry key。" : "当前控制器没有 texture key。")}</p></div>`}
                ${!resources.length ? `<div class="slot-card"><h4>${escapeHtml(resourceHint)}</h4><p>${escapeHtml(emptyText)}</p></div>` : ""}
            </div>
        `;
    }

    /**
     * 渲染单个动画控制器绑定卡片，每个控制器维护自己的一套动作键映射。
     */
    function renderAnimationControllerBindingCard(entity, binding, index, total, availableAnimations) {
        const currentPreset = getAnimationControllerPreset(binding.controller);
        const slotNames = getBindingSlotNames(binding);
        const hasCurrentPreset = CONTROLLER_PRESETS.some((preset) => preset.name === binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        const controllerDescription = currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : "";
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">动画控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(binding.key || "未命名绑定")} -> ${escapeHtml(controllerDisplayName)}</p>
                        ${controllerDescription}
                    </div>
                    ${total > 1 ? `<button class="button danger" type="button" data-action="remove-animation-controller" data-animation-binding-id="${escapeAttribute(binding.id)}">移除</button>` : ""}
                </div>
                <div class="form-grid">
                    <div class="field">
                        <label for="animationBindingKey-${escapeAttribute(binding.id)}">绑定 key</label>
                        <input id="animationBindingKey-${escapeAttribute(binding.id)}" type="text" value="${escapeAttribute(binding.key || "")}" data-animation-binding-key="${escapeAttribute(binding.id)}" placeholder="${DEFAULT_ANIMATION_BINDING_KEY}">
                        <p class="field-hint">例如 <code>default</code>、<code>test</code>。<code>${escapeHtml(SYSTEM_SCALE_CONTROLLER_KEY)}</code> 为系统保留字。</p>
                    </div>
                    <div class="field field-wide">
                        <label for="animationBindingController-${escapeAttribute(binding.id)}">控制器</label>
                        <select id="animationBindingController-${escapeAttribute(binding.id)}" data-animation-binding-controller="${escapeAttribute(binding.id)}">
                            ${binding.controller && !hasCurrentPreset ? `<option value="${escapeAttribute(binding.controller)}" selected>${escapeHtml(binding.controller)}（未收录）</option>` : ""}
                            ${CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === binding.controller ? "selected" : ""}>${escapeHtml(formatControllerOptionLabel(preset, preset.name))}</option>`).join("")}
                        </select>
                        ${currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : '<p class="field-hint">未找到该控制器的中文说明。</p>'}
                    </div>
                </div>
                ${slotNames.length ? `
                    <div class="slot-grid">
                        ${slotNames.map((slotName) => `
                            <div class="slot-card">
                                <h4>${escapeHtml(slotName)}</h4>
                                <p class="field-hint">${escapeHtml(getAnimationSlotDescription(binding, slotName) || "这个槽位需要绑定一个动作；如果留空，则导出时不会写出该槽位。")}</p>
                                <select data-animation-slot-binding-id="${escapeAttribute(binding.id)}" data-slot-name="${escapeAttribute(slotName)}">
                                    <option value="">不导出这个槽位</option>
                                    ${availableAnimations.map((animationName) => `<option value="${escapeAttribute(animationName)}" ${binding.animationMappings[slotName] === animationName ? "selected" : ""}>${escapeHtml(animationName)}</option>`).join("")}
                                </select>
                                <p>${binding.animationMappings[slotName] ? `导出后会改写为 animation.${escapeHtml(entity.baseName || "实体名")}.${escapeHtml(slotName)}` : "当前槽位未映射"}</p>
                            </div>
                        `).join("")}
                    </div>
                ` : '<p class="field-hint">当前控制器没有识别到可编辑的动作 key。</p>'}
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
        const textureLines = getTextureResources(entity).length
            ? getTextureResources(entity).map((resource) => `${ROOT_DIR}/${RESOURCE_ROOT}/${buildTextureResourcePath({
                baseName: name,
                resourceSubdir: entity.resourceSubdir,
            }, resource)}.png`)
            : [`${ROOT_DIR}/${RESOURCE_ROOT}/textures/entity/${entity.resourceSubdir}/${name}.png`];
        const lines = [
            ...textureLines,
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
            renderControllers: [
                createRenderControllerBinding(),
            ],
            animationControllerBindings: [
                createAnimationControllerBinding(),
            ],
            files: {
                textures: [],
                geometries: [],
                texture: null,
                geometry: null,
                animation: null,
            },
            entityProfile: createDefaultEntityProfile(),
        };
    }

    /**
     * 创建默认渲染控制器绑定。
     */
    function createRenderControllerBinding(options) {
        const normalized = options || {};
        return {
            id: normalized.id || createId(),
            controller: normalized.controller || DEFAULT_RENDER_CONTROLLER,
            condition: typeof normalized.condition === "string" ? normalized.condition : "",
            geometryMappings: normalizeSimpleStringMap(normalized.geometryMappings),
            textureMappings: normalizeSimpleStringMap(normalized.textureMappings),
        };
    }

    /**
     * 创建默认的贴图资源记录，每条记录对应一张 png。
     */
    function createTextureResource(options) {
        const normalized = options || {};
        return {
            id: normalized.id || createId(),
            resourceKey: normalizeResourceKey(normalized.resourceKey || "default"),
            sourceName: typeof normalized.sourceName === "string" ? normalized.sourceName : "",
            buffer: normalized.buffer || null,
        };
    }

    /**
     * 创建默认的模型资源记录，每条记录对应一个 geo.json 文件。
     */
    function createGeometryResource(options) {
        const normalized = options || {};
        return {
            id: normalized.id || createId(),
            resourceKey: normalizeResourceKey(normalized.resourceKey || "default"),
            sourceName: typeof normalized.sourceName === "string" ? normalized.sourceName : "",
            json: normalized.json || null,
        };
    }

    /**
     * 创建默认动画控制器绑定，不包含系统 scale 控制器。
     */
    function createAnimationControllerBinding(options) {
        const normalized = options || {};
        return {
            id: normalized.id || createId(),
            key: normalized.key || DEFAULT_ANIMATION_BINDING_KEY,
            controller: normalized.controller || DEFAULT_CONTROLLER,
            animationMappings: normalizeAnimationMappings(normalized.animationMappings),
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
                    label: entry.label || "",
                    description: entry.description || "",
                    source: entry.source || "",
                    slotDescriptions: {},
                    slots: [],
                });
            }

            const preset = presetMap.get(entry.name);
            if (!preset.label && entry.label) {
                preset.label = entry.label;
            }
            if (!preset.description && entry.description) {
                preset.description = entry.description;
            }
            if (!preset.source && entry.source) {
                preset.source = entry.source;
            }
            Object.entries(entry.slotDescriptions || {}).forEach(([slotName, description]) => {
                if (!preset.slotDescriptions[slotName] && description) {
                    preset.slotDescriptions[slotName] = description;
                }
            });
            entry.slots.forEach((slotName) => {
                if (!preset.slots.includes(slotName)) {
                    preset.slots.push(slotName);
                }
            });
        });

        return Array.from(presetMap.values())
            .map((preset) => ({
                name: preset.name,
                label: preset.label,
                description: preset.description,
                source: preset.source,
                slotDescriptions: { ...preset.slotDescriptions },
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
                    label: entry.label || "",
                    description: entry.description || "",
                    source: entry.source || "",
                    geometryKeys: [],
                    textureKeys: [],
                    materialKeys: [],
                    partVisibilityKeys: [],
                });
            }

            const preset = presetMap.get(entry.name);
            if (!preset.label && entry.label) {
                preset.label = entry.label;
            }
            if (!preset.description && entry.description) {
                preset.description = entry.description;
            }
            if (!preset.source && entry.source) {
                preset.source = entry.source;
            }
            mergeUniqueValues(preset.geometryKeys, entry.geometryKeys || []);
            mergeUniqueValues(preset.textureKeys, entry.textureKeys || []);
            mergeUniqueValues(preset.materialKeys, entry.materialKeys || []);
            mergeUniqueValues(preset.partVisibilityKeys, entry.partVisibilityKeys || []);
        });

        return Array.from(presetMap.values())
            .map((preset) => ({
                name: preset.name,
                label: preset.label,
                description: preset.description,
                source: preset.source,
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

    /**
     * 获取动画控制器预设完整信息，供中文说明和槽位提示使用。
     */
    function getAnimationControllerPreset(controllerName) {
        return CONTROLLER_PRESETS.find((item) => item.name === controllerName) || null;
    }

    /**
     * 获取渲染控制器预设完整信息，供中文说明和下拉展示使用。
     */
    function getRenderControllerPreset(controllerName) {
        return RENDER_CONTROLLER_PRESETS.find((item) => item.name === controllerName) || null;
    }

    /**
     * 统一格式化控制器名称，优先展示中文标签，同时保留英文原名方便复制。
     */
    function formatControllerOptionLabel(preset, fallbackName) {
        if (!preset) {
            return fallbackName || "";
        }
        if (!preset.label) {
            return preset.name;
        }
        return `${preset.label}（${preset.name}）`;
    }

    /**
     * 卡片标题和下拉框共用的控制器展示文本。
     */
    function formatControllerDisplayName(preset, fallbackName) {
        return formatControllerOptionLabel(preset, fallbackName || "未选择控制器");
    }

    /**
     * 组装控制器说明文案，避免动画控制器和渲染控制器各写一套模板。
     */
    function buildControllerDescriptionHtml(description, source) {
        const lines = [];
        if (description) {
            lines.push(description);
        }
        if (source) {
            lines.push(`来源：${source}`);
        }
        if (!lines.length) {
            return "";
        }
        return lines.map((line) => `<p class="field-hint">${escapeHtml(line)}</p>`).join("");
    }

    /**
     * 读取动画控制器某个动作槽位的中文提示，没有配置时返回空字符串。
     */
    function getAnimationSlotDescription(binding, slotName) {
        const preset = getAnimationControllerPreset(binding.controller);
        if (!preset || !preset.slotDescriptions) {
            return "";
        }
        return preset.slotDescriptions[slotName] || "";
    }

    /**
     * 把资源 key 统一裁剪成安全的导出片段，只保留字母、数字和下划线。
     */
    function normalizeResourceKey(value) {
        const normalized = String(value || "")
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return normalized || "default";
    }

    /**
     * 为新增资源生成不重复的内部 key；首个资源固定使用 default，兼容旧导出格式。
     */
    function suggestResourceKey(resources, fileName, fallbackPrefix) {
        if (!resources.length) {
            return "default";
        }

        const desired = normalizeResourceKey(deriveBaseNameFromFile(fileName, fallbackPrefix));
        const baseKey = desired === "default" ? fallbackPrefix : desired;
        return ensureUniqueResourceKey(resources.map((item) => item.resourceKey), baseKey);
    }

    /**
     * 确保同一实体内部的资源 key 唯一，避免导出路径和 geometry 标识符冲突。
     */
    function ensureUniqueResourceKey(existingKeys, desiredKey) {
        const used = new Set((existingKeys || []).map((item) => normalizeResourceKey(item)));
        const baseKey = normalizeResourceKey(desiredKey || "default");
        if (!used.has(baseKey)) {
            return baseKey;
        }

        let suffix = 2;
        let nextKey = `${baseKey}_${suffix}`;
        while (used.has(nextKey)) {
            suffix += 1;
            nextKey = `${baseKey}_${suffix}`;
        }
        return nextKey;
    }

    /**
     * 把旧版单贴图结构迁移成贴图资源列表，并顺手清理脏数据。
     */
    function getTextureResources(entity) {
        if (!entity.files || typeof entity.files !== "object") {
            entity.files = {};
        }

        if (!Array.isArray(entity.files.textures)) {
            entity.files.textures = entity.files.texture
                ? [createTextureResource({
                    sourceName: entity.files.texture.sourceName,
                    buffer: entity.files.texture.buffer,
                    resourceKey: "default",
                })]
                : [];
        }

        const normalizedResources = [];
        entity.files.textures
            .filter((resource) => resource && typeof resource === "object" && resource.buffer)
            .forEach((resource) => {
                const created = createTextureResource(resource);
                created.resourceKey = ensureUniqueResourceKey(
                    normalizedResources.map((item) => item.resourceKey),
                    created.resourceKey
                );
                normalizedResources.push(created);
            });

        entity.files.textures = normalizedResources;
        entity.files.texture = null;
        return entity.files.textures;
    }

    /**
     * 把旧版单模型结构迁移成模型资源列表，并保持每条记录都是独立对象。
     */
    function getGeometryResources(entity) {
        if (!entity.files || typeof entity.files !== "object") {
            entity.files = {};
        }

        if (!Array.isArray(entity.files.geometries)) {
            entity.files.geometries = entity.files.geometry
                ? [createGeometryResource({
                    sourceName: entity.files.geometry.sourceName,
                    json: entity.files.geometry.json,
                    resourceKey: "default",
                })]
                : [];
        }

        const normalizedResources = [];
        entity.files.geometries
            .filter((resource) => resource && typeof resource === "object" && resource.json)
            .forEach((resource) => {
                const created = createGeometryResource(resource);
                created.resourceKey = ensureUniqueResourceKey(
                    normalizedResources.map((item) => item.resourceKey),
                    created.resourceKey
                );
                normalizedResources.push(created);
            });

        entity.files.geometries = normalizedResources;
        entity.files.geometry = null;
        return entity.files.geometries;
    }

    /**
     * 统一清洗简单 key-value 映射，只保留字符串值。
     */
    function normalizeSimpleStringMap(input) {
        if (!input || typeof input !== "object") {
            return {};
        }

        const normalized = {};
        Object.keys(input).forEach((key) => {
            if (typeof input[key] === "string") {
                normalized[key] = input[key];
            }
        });
        return normalized;
    }

    /**
     * 为单个渲染控制器卡片里的每个 key 指向一个有效资源；没有显式选择时默认落到首个资源。
     */
    function buildRenderBindingMappingState(keys, existingMappings, resources) {
        const normalizedMappings = normalizeSimpleStringMap(existingMappings);
        const defaultResourceId = resources[0] ? resources[0].id : "";
        const result = {};

        keys.forEach((key) => {
            const currentValue = normalizedMappings[key];
            const matched = resources.find((resource) => resource.id === currentValue);
            result[key] = matched ? matched.id : defaultResourceId;
        });

        return result;
    }

    /**
     * 根据 id 查找贴图资源。
     */
    function findTextureResource(entity, resourceId) {
        return getTextureResources(entity).find((resource) => resource.id === resourceId) || null;
    }

    /**
     * 根据 id 查找模型资源。
     */
    function findGeometryResource(entity, resourceId) {
        return getGeometryResources(entity).find((resource) => resource.id === resourceId) || null;
    }

    /**
     * 生成模型资源在导出后的 geometry 标识符。
     */
    function buildGeometryResourceIdentifier(entity, resource, geometryIndex) {
        const baseIdentifier = resource && resource.resourceKey !== "default"
            ? `geometry.${entity.baseName}.${resource.resourceKey}`
            : `geometry.${entity.baseName}`;
        if (geometryIndex > 0) {
            return `${baseIdentifier}_${geometryIndex + 1}`;
        }
        return baseIdentifier;
    }

    /**
     * 生成贴图资源在导出后的贴图路径，不包含 png 后缀。
     */
    function buildTextureResourcePath(entity, resource) {
        const fileName = resource && resource.resourceKey !== "default"
            ? `${entity.baseName}_${resource.resourceKey}`
            : entity.baseName;
        return `textures/entity/${entity.resourceSubdir}/${fileName}`;
    }

    /**
     * 生成贴图导出清单，供 ZIP 打包阶段直接消费。
     */
    function buildTextureExportFiles(entity) {
        return getTextureResources(entity).map((resource) => ({
            path: `${ROOT_DIR}/${RESOURCE_ROOT}/${buildTextureResourcePath(entity, resource)}.png`,
            buffer: resource.buffer,
        }));
    }

    /**
     * 把旧版“实体级全局渲染映射”尽量搬进第一张可承载对应 key 的渲染控制器卡片。
     */
    function migrateLegacyRenderResourceMappings(entity, bindings) {
        if (!entity.renderResourceMappings || typeof entity.renderResourceMappings !== "object") {
            return;
        }

        const legacyGeometry = normalizeSimpleStringMap(entity.renderResourceMappings.geometry);
        const legacyTexture = normalizeSimpleStringMap(entity.renderResourceMappings.texture);

        Object.keys(legacyGeometry).forEach((key) => {
            const binding = bindings.find((item) => getRenderBindingKeys(item, "geometry").includes(key));
            if (binding && !binding.geometryMappings[key]) {
                binding.geometryMappings[key] = legacyGeometry[key];
            }
        });

        Object.keys(legacyTexture).forEach((key) => {
            const binding = bindings.find((item) => getRenderBindingKeys(item, "texture").includes(key));
            if (binding && !binding.textureMappings[key]) {
                binding.textureMappings[key] = legacyTexture[key];
            }
        });

        delete entity.renderResourceMappings;
    }

    /**
     * 兼容旧结构，把单个渲染控制器迁移为可编辑的渲染控制器列表。
     */
    function getRenderControllers(entity) {
        if (!Array.isArray(entity.renderControllers) || !entity.renderControllers.length) {
            entity.renderControllers = [
                createRenderControllerBinding({
                    controller: entity.renderController || DEFAULT_RENDER_CONTROLLER,
                    condition: "",
                }),
            ];
        }

        entity.renderControllers = entity.renderControllers
            .filter((binding) => binding && typeof binding === "object")
            .map((binding) => createRenderControllerBinding(binding));

        migrateLegacyRenderResourceMappings(entity, entity.renderControllers);
        const geometryResources = getGeometryResources(entity);
        const textureResources = getTextureResources(entity);
        entity.renderControllers.forEach((binding) => syncRenderBindingMappings(binding, geometryResources, textureResources));

        if (!entity.renderControllers.length) {
            entity.renderControllers = [createRenderControllerBinding()];
        }
        return entity.renderControllers;
    }

    /**
     * 兼容旧结构，把单个动画控制器迁移为“多绑定，每绑定自带动作映射”的结构。
     */
    function getAnimationControllerBindings(entity) {
        if (!Array.isArray(entity.animationControllerBindings) || !entity.animationControllerBindings.length) {
            entity.animationControllerBindings = [
                createAnimationControllerBinding({
                    key: DEFAULT_ANIMATION_BINDING_KEY,
                    controller: entity.animateController || DEFAULT_CONTROLLER,
                    animationMappings: entity.animationMappings,
                }),
            ];
        }

        entity.animationControllerBindings = entity.animationControllerBindings
            .filter((binding) => binding && typeof binding === "object")
            .map((binding) => createAnimationControllerBinding(binding));

        if (!entity.animationControllerBindings.length) {
            entity.animationControllerBindings = [createAnimationControllerBinding()];
        }
        return entity.animationControllerBindings;
    }

    /**
     * 统一清洗动画映射，避免旧数据中的非字符串值污染导出。
     */
    function normalizeAnimationMappings(animationMappings) {
        if (!animationMappings || typeof animationMappings !== "object") {
            return {};
        }

        const normalized = {};
        Object.keys(animationMappings).forEach((slotName) => {
            const value = animationMappings[slotName];
            if (typeof value === "string") {
                normalized[slotName] = value;
            }
        });
        return normalized;
    }

    /**
     * 统一清洗渲染控制器内部的资源映射，只保留字符串值。
     */
    function normalizeRenderBindingMappings(mappings) {
        return normalizeSimpleStringMap(mappings);
    }

    /**
     * 获取某个动画控制器绑定当前可编辑的所有动作 key。
     */
    function getBindingSlotNames(binding) {
        const slotNames = [];
        mergeUniqueValues(slotNames, getControllerSlots(binding.controller));
        Object.keys(binding.animationMappings || {})
            .sort(compareSlotNames)
            .forEach((slotName) => mergeUniqueValues(slotNames, [slotName]));
        return slotNames;
    }

    /**
     * 汇总当前实体所有动画控制器绑定的动作 key。
     */
    function collectAnimationSlotNames(entity) {
        const slotNames = [];
        getAnimationControllerBindings(entity).forEach((binding) => {
            mergeUniqueValues(slotNames, getBindingSlotNames(binding));
        });
        return slotNames.sort(compareSlotNames);
    }

    /**
     * 获取某个渲染控制器当前可编辑的 geometry / texture key。
     */
    function getRenderBindingKeys(binding, type) {
        const preset = getRenderControllerPreset(binding.controller);
        const mappingSource = type === "geometry" ? binding.geometryMappings : binding.textureMappings;
        if (preset) {
            const presetKeys = type === "geometry" ? preset.geometryKeys : preset.textureKeys;
            return (presetKeys && presetKeys.length ? [...presetKeys] : []).sort(compareSlotNames);
        }

        return Object.keys(mappingSource || {}).sort(compareSlotNames);
    }

    /**
     * 保证渲染控制器卡片内部的 key->资源 映射始终有效。
     */
    function syncRenderBindingMappings(binding, geometryResources, textureResources) {
        binding.geometryMappings = buildRenderBindingMappingState(
            getRenderBindingKeys(binding, "geometry"),
            binding.geometryMappings,
            geometryResources
        );
        binding.textureMappings = buildRenderBindingMappingState(
            getRenderBindingKeys(binding, "texture"),
            binding.textureMappings,
            textureResources
        );
    }

    /**
     * 给单个渲染控制器卡片生成可直接渲染的映射条目。
     */
    function getRenderBindingMappingEntries(entity, binding, type, resources) {
        const mappingSource = type === "geometry" ? binding.geometryMappings : binding.textureMappings;
        const availableKeys = getRenderBindingKeys(binding, type);
        return availableKeys.map((key) => {
            const resource = resources.find((item) => item.id === mappingSource[key]) || resources[0] || null;
            return {
                key,
                availableKeys,
                resourceId: resource ? resource.id : "",
                previewText: type === "geometry"
                    ? `导出为 ${resource ? buildGeometryResourceIdentifier(entity, resource, 0) : "未选择模型资源"}`
                    : `导出为 ${resource ? `${buildTextureResourcePath(entity, resource)}.png` : "未选择贴图资源"}`,
            };
        });
    }

    function collectRenderBindings(entity) {
        const geometryKeyEntries = [];
        const textureKeyEntries = [];
        const materialKeys = [];
        const partVisibilityKeys = [];
        const geometryResources = getGeometryResources(entity);
        const textureResources = getTextureResources(entity);

        getRenderControllers(entity).forEach((binding) => {
            const preset = getRenderControllerPreset(binding.controller);
            syncRenderBindingMappings(binding, geometryResources, textureResources);
            if (!preset) {
                return;
            }
            mergeUniqueValues(materialKeys, preset.materialKeys || []);
            mergeUniqueValues(partVisibilityKeys, preset.partVisibilityKeys || []);
            getRenderBindingKeys(binding, "geometry").forEach((key) => {
                const resource = geometryResources.find((item) => item.id === binding.geometryMappings[key]) || geometryResources[0] || null;
                if (!resource || geometryKeyEntries.some((entry) => entry.key === key)) {
                    return;
                }
                geometryKeyEntries.push({
                    key,
                    resourceId: resource.id,
                    resourceName: resource.sourceName,
                    identifier: buildGeometryResourceIdentifier(entity, resource, 0),
                });
            });
            getRenderBindingKeys(binding, "texture").forEach((key) => {
                const resource = textureResources.find((item) => item.id === binding.textureMappings[key]) || textureResources[0] || null;
                if (!resource || textureKeyEntries.some((entry) => entry.key === key)) {
                    return;
                }
                textureKeyEntries.push({
                    key,
                    resourceId: resource.id,
                    resourceName: resource.sourceName,
                    path: buildTextureResourcePath(entity, resource),
                });
            });
        });

        return {
            geometryKeys: geometryKeyEntries.map((entry) => entry.key),
            textureKeys: textureKeyEntries.map((entry) => entry.key),
            geometryEntries: geometryKeyEntries.length ? geometryKeyEntries : [{
                key: "default",
                resourceId: "",
                resourceName: "",
                identifier: `geometry.${entity.baseName}`,
            }],
            textureEntries: textureKeyEntries.length ? textureKeyEntries : [{
                key: "default",
                resourceId: "",
                resourceName: "",
                path: `textures/entity/${entity.resourceSubdir}/${entity.baseName}`,
            }],
            materialKeys,
            partVisibilityKeys,
        };
    }

    /**
     * 把多个动画控制器的映射合并成最终导出的 animate 列表，并收集冲突。
     */
    function getMergedAnimationEntries(entity) {
        const entryMap = new Map();
        const conflicts = [];

        getAnimationControllerBindings(entity).forEach((binding) => {
            getBindingSlotNames(binding).forEach((slotName) => {
                const sourceName = binding.animationMappings[slotName];
                if (!sourceName) {
                    return;
                }

                if (!entryMap.has(slotName)) {
                    entryMap.set(slotName, {
                        key: slotName,
                        sourceName,
                        name: `animation.${entity.baseName}.${slotName}`,
                        bindingKey: binding.key,
                    });
                    return;
                }

                const existing = entryMap.get(slotName);
                if (existing.sourceName !== sourceName) {
                    conflicts.push({
                        key: slotName,
                        firstBindingKey: existing.bindingKey,
                        firstSourceName: existing.sourceName,
                        secondBindingKey: binding.key,
                        secondSourceName: sourceName,
                    });
                }
            });
        });

        return {
            entries: Array.from(entryMap.values()).sort((left, right) => compareSlotNames(left.key, right.key)),
            conflicts,
        };
    }

    /**
     * 检查单个控制器绑定是否已经有任意动作映射。
     */
    function hasAnyAnimationMappings(binding) {
        return Object.values(binding.animationMappings || {}).some(Boolean);
    }

    /**
     * 收集当前实体所有已经占用的原始动作名。
     */
    function getUsedAnimationSourceNames(entity) {
        const used = new Set();
        getAnimationControllerBindings(entity).forEach((binding) => {
            Object.values(binding.animationMappings || {}).forEach((sourceName) => {
                if (sourceName) {
                    used.add(sourceName);
                }
            });
        });
        return used;
    }

    /**
     * 给新增动画控制器生成一个尽量直观且不重复的绑定 key。
     */
    function suggestNextAnimationBindingKey(bindings) {
        const used = new Set(bindings.map((binding) => binding.key));
        if (!used.has("test")) {
            return "test";
        }
        let index = 2;
        while (used.has(`test${index}`)) {
            index += 1;
        }
        return `test${index}`;
    }

    /**
     * 按 id 查找渲染控制器绑定。
     */
    function findRenderControllerBinding(entity, bindingId) {
        return getRenderControllers(entity).find((binding) => binding.id === bindingId) || null;
    }

    /**
     * 按 id 查找动画控制器绑定。
     */
    function findAnimationControllerBinding(entity, bindingId) {
        return getAnimationControllerBindings(entity).find((binding) => binding.id === bindingId) || null;
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
     * 兼容旧实体数据，确保 service profile 总能拿到完整默认值。
     */
    function getEntityProfile(entity) {
        entity.entityProfile = {
            ...createDefaultEntityProfile(),
            ...(entity.entityProfile || {}),
        };
        return entity.entityProfile;
    }

    /**
     * 确保实体始终持有完整的标题配置，兼容旧数据结构和复制逻辑。
     */
    function getEntityTitleProfile(entity) {
        const entityProfile = getEntityProfile(entity);
        entityProfile.title = {
            ...createDefaultTitleProfile(),
            ...(entityProfile.title || {}),
        };
        return entityProfile.title;
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
