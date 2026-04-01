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
        return baseJson;
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

        if (hasCustomEntityProfile(entity)) {
            lines.push("  entity_profile:");
            lines.push("    # 碰撞箱");
            lines.push(`    width: ${entity.entityProfile.width}`);
            lines.push(`    height: ${entity.entityProfile.height}`);
            lines.push("    # 模型缩放");
            lines.push(`    scale: ${entity.entityProfile.scale}`);
        }

        return lines.join("\n");
    }

    function hasCustomEntityProfile(entity) {
        return entity.entityProfile.width !== DEFAULT_ENTITY_PROFILE.width
            || entity.entityProfile.height !== DEFAULT_ENTITY_PROFILE.height
            || entity.entityProfile.scale !== DEFAULT_ENTITY_PROFILE.scale;
    }

    function parseEntityProfileValue(value, fallback) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : fallback;
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
                ${slots.length ? `
                    <div class="slot-grid">
                        ${slots.map((slotName) => `
                            <div class="field">
                                <label for="profileWidthInput">碰撞箱宽度</label>
                                <input id="profileWidthInput" type="number" min="0.01" step="0.1" value="${escapeAttribute(entity.entityProfile.width)}">
                                <p class="field-hint">默认值为 <code>1</code>，仅在服务端插件配置中使用。</p>
                            </div>
                            <div class="field">
                                <label for="profileHeightInput">碰撞箱高度</label>
                                <input id="profileHeightInput" type="number" min="0.01" step="0.1" value="${escapeAttribute(entity.entityProfile.height)}">
                                <p class="field-hint">默认值为 <code>2</code>，仅在服务端插件配置中使用。</p>
                            </div>
                            <div class="field">
                                <label for="profileScaleInput">模型缩放</label>
                                <input id="profileScaleInput" type="number" min="0.01" step="0.1" value="${escapeAttribute(entity.entityProfile.scale)}">
                                <p class="field-hint">默认值为 <code>1</code>。</p>
                            </div>
                        `).join("")}
                    </div>
                ` : '<p class="empty-state"></p>'}
                ${unusedAnimations.length ? `<div class="chip-row">${unusedAnimations.map((name) => `<span class="chip muted">${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="field-hint"></p>'}
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

        profileWidthInput.addEventListener("input", (event) => {
            const focusState = captureInspectorFocus();
            entity.entityProfile.width = parseEntityProfileValue(event.target.value, DEFAULT_ENTITY_PROFILE.width);
            render();
            restoreInspectorFocus(focusState);
        });

        profileHeightInput.addEventListener("input", (event) => {
            const focusState = captureInspectorFocus();
            entity.entityProfile.height = parseEntityProfileValue(event.target.value, DEFAULT_ENTITY_PROFILE.height);
            render();
            restoreInspectorFocus(focusState);
        });

        profileScaleInput.addEventListener("input", (event) => {
            const focusState = captureInspectorFocus();
            entity.entityProfile.scale = parseEntityProfileValue(event.target.value, DEFAULT_ENTITY_PROFILE.scale);
            render();
            restoreInspectorFocus(focusState);
        });

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
            clone.entityProfile = { ...entity.entityProfile };
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
            entityProfile: { ...DEFAULT_ENTITY_PROFILE },
            animationMappings: {},
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
