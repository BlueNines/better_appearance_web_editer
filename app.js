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
    const AUTO_ANIMATION_TARGET_GEOMETRY = "auto";
    const BONE_NAMESPACE_PREFIX = "ba";
    const SYSTEM_SCALE_CONTROLLER_KEY = "scale";
    const SYSTEM_SCALE_CONTROLLER_NAME = "controller.animation.auto.scale";
    const DEFAULT_ENTITY_PROFILE = {
        width: 1,
        height: 2,
        scale: 1,
        opacity: 1,
        redGain: 1,
        greenGain: 1,
        blueGain: 1,
        brightness: 1,
        ignoreLight: false,
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
    let graphDragAutoScrollState = null;

    const elements = {
        resourceInput: document.getElementById("resourceInput"),
        resourcePackInput: document.getElementById("resourcePackInput"),
        exportUseControllersButton: document.getElementById("exportUseControllersButton"),
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

        elements.resourcePackInput.addEventListener("change", async (event) => {
            await importResourcePackFiles(event.target.files);
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

        elements.exportUseControllersButton.addEventListener("click", async () => {
            await exportUseControllersZip();
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

    /**
     * 从完整资源包目录导入实体配置，入口只消费浏览器给出的 FileList，不修改源目录。
     */
    async function importResourcePackFiles(fileList) {
        const files = Array.from(fileList || []);
        if (!files.length) {
            return;
        }

        setStatus(`正在扫描资源包：${files.length} 个文件。`);
        try {
            const context = await buildResourcePackImportContext(files);
            context.warnings.slice(0, 6).forEach((message) => addMessage(message, "warn"));
            if (context.warnings.length > 6) {
                addMessage(`资源包扫描还有 ${context.warnings.length - 6} 条警告未展示。`, "warn");
            }
            if (!context.clientEntities.length) {
                addMessage("没有在资源包中找到 entity/*.entity.json，无法自动还原实体。", "warn");
                setStatus("资源包导入失败：没有找到客户端实体配置。");
                render();
                return;
            }

            const selectedCandidates = chooseResourcePackCandidates(context.clientEntities);
            if (!selectedCandidates.length) {
                setStatus("已取消资源包导入。");
                render();
                return;
            }

            const importedEntities = [];
            for (const candidate of selectedCandidates) {
                const entity = await importResourcePackCandidate(candidate, context);
                if (entity) {
                    importedEntities.push(entity);
                }
            }

            importedEntities.slice().reverse().forEach((entity) => state.entities.unshift(entity));
            if (importedEntities.length) {
                selectEntity(importedEntities[0].id);
                setStatus(`已从资源包导入 ${importedEntities.length} 个实体。`);
                addMessage(`资源包导入完成：${importedEntities.map((entity) => entity.baseName).join("、")}`, "info");
            } else {
                setStatus("资源包中没有可导入的实体。");
            }
        } catch (error) {
            addMessage(`资源包导入失败：${error.message}`, "error");
            setStatus("资源包导入失败。");
        }
        render();
    }

    /**
     * 扫描资源包文件并建立反查索引，JSON 在扫描期读取，PNG 只记录路径避免无谓占用内存。
     */
    async function buildResourcePackImportContext(files) {
        const context = {
            clientEntities: [],
            geometryByIdentifier: new Map(),
            textureByPath: new Map(),
            animationByName: new Map(),
            warnings: [],
        };

        for (const file of files) {
            const logicalPath = getResourcePackLogicalPath(file);
            const lowerPath = logicalPath.toLowerCase();
            try {
                if (isResourcePackClientEntityPath(lowerPath)) {
                    const json = await readJsonImportFile(file);
                    const candidate = createResourcePackCandidate(file, logicalPath, json);
                    if (candidate) {
                        context.clientEntities.push(candidate);
                    }
                    continue;
                }

                if (isResourcePackGeometryPath(lowerPath)) {
                    const json = await readJsonImportFile(file);
                    registerResourcePackGeometryFile(context, file, logicalPath, json);
                    continue;
                }

                if (isResourcePackAnimationPath(lowerPath)) {
                    const json = await readJsonImportFile(file);
                    registerResourcePackAnimationFile(context, file, logicalPath, json);
                    continue;
                }

                if (isResourcePackTexturePath(lowerPath)) {
                    registerResourcePackTextureFile(context, file, logicalPath);
                }
            } catch (error) {
                context.warnings.push(`已跳过 ${logicalPath}：${error.message}`);
            }
        }

        context.clientEntities.sort((left, right) => left.baseName.localeCompare(right.baseName));
        return context;
    }

    /**
     * 读取并解析导入用 JSON，错误中保留文件名方便用户定位资源包坏文件。
     */
    async function readJsonImportFile(file) {
        const text = await file.text();
        try {
            return JSON.parse(text);
        } catch (firstError) {
            try {
                return JSON.parse(stripJsonComments(text));
            } catch (_secondError) {
                throw new Error(`JSON 无法解析：${file.name}（${firstError.message}）`);
            }
        }
    }

    /**
     * 去掉 JSONC 风格注释，只处理字符串外的行注释和块注释，兼容资源包里手写注释。
     */
    function stripJsonComments(text) {
        let result = "";
        let inString = false;
        let escaped = false;
        for (let index = 0; index < text.length; index += 1) {
            const current = text[index];
            const next = text[index + 1];

            if (inString) {
                result += current;
                if (escaped) {
                    escaped = false;
                    continue;
                }
                if (current === "\\") {
                    escaped = true;
                    continue;
                }
                if (current === "\"") {
                    inString = false;
                }
                continue;
            }

            if (current === "\"") {
                inString = true;
                result += current;
                continue;
            }

            if (current === "/" && next === "/") {
                while (index < text.length && text[index] !== "\n") {
                    index += 1;
                }
                result += "\n";
                continue;
            }

            if (current === "/" && next === "*") {
                index += 2;
                while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
                    index += 1;
                }
                index += 1;
                continue;
            }

            result += current;
        }
        return result;
    }

    /**
     * 把 webkitRelativePath 裁剪到资源包内部路径，兼容用户选择资源包本身或上级目录。
     */
    function getResourcePackLogicalPath(file) {
        const rawPath = String(file.webkitRelativePath || file.name || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "");
        const parts = rawPath.split("/").filter(Boolean);
        const rootSegments = ["entity", "models", "textures", "animations"];
        const rootIndex = parts.findIndex((segment) => rootSegments.includes(segment));
        return rootIndex >= 0 ? parts.slice(rootIndex).join("/") : rawPath;
    }

    /**
     * 判断资源包客户端实体配置路径。
     */
    function isResourcePackClientEntityPath(lowerPath) {
        return lowerPath.endsWith(".entity.json") && (lowerPath.startsWith("entity/") || !lowerPath.includes("/"));
    }

    /**
     * 判断资源包模型路径。
     */
    function isResourcePackGeometryPath(lowerPath) {
        return lowerPath.endsWith(".geo.json") && (lowerPath.startsWith("models/") || !lowerPath.includes("/"));
    }

    /**
     * 判断资源包动作路径。
     */
    function isResourcePackAnimationPath(lowerPath) {
        return lowerPath.endsWith(".animation.json") && (lowerPath.startsWith("animations/") || !lowerPath.includes("/"));
    }

    /**
     * 判断资源包贴图路径。
     */
    function isResourcePackTexturePath(lowerPath) {
        return lowerPath.endsWith(".png") && (lowerPath.startsWith("textures/") || !lowerPath.includes("/"));
    }

    /**
     * 从客户端实体 JSON 中提取可导入候选，保留原始引用关系供后续连线。
     */
    function createResourcePackCandidate(file, logicalPath, json) {
        const description = json
            && json["minecraft:client_entity"]
            && json["minecraft:client_entity"].description;
        if (!description || typeof description !== "object") {
            return null;
        }

        const baseName = normalizeImportedBaseName(deriveClientEntityBaseName(logicalPath));
        const identifier = typeof description.identifier === "string" && description.identifier.trim()
            ? description.identifier.trim()
            : `netease:${baseName}`;
        const geometryRefs = normalizeClientEntityStringMap(description.geometry);
        const textureRefs = normalizeClientEntityStringMap(description.textures);
        const animationRefs = normalizeClientEntityStringMap(description.animations);

        return {
            file,
            logicalPath,
            baseName,
            identifier,
            geometryRefs,
            textureRefs,
            animationRefs,
            renderControllers: parseClientRenderControllers(description.render_controllers),
            animationControllers: parseClientAnimationControllers(description.animation_controllers),
        };
    }

    /**
     * 从 entity 文件路径推导基础名，避免普通 deriveBaseName 把 .entity 留在名字里。
     */
    function deriveClientEntityBaseName(logicalPath) {
        const fileName = getFileNameFromPath(logicalPath);
        if (fileName.toLowerCase().endsWith(".entity.json")) {
            return fileName.slice(0, -12);
        }
        return fileName.replace(/\.[^.]+$/, "");
    }

    /**
     * 导入实体基础名必须满足导出校验，非法字符统一压成下划线。
     */
    function normalizeImportedBaseName(value) {
        const normalized = normalizeResourceKey(value);
        return normalized || "imported_entity";
    }

    /**
     * 清洗客户端实体 description 中的 key -> string 字段。
     */
    function normalizeClientEntityStringMap(input) {
        const result = {};
        if (!input || typeof input !== "object" || Array.isArray(input)) {
            return result;
        }

        Object.keys(input).forEach((key) => {
            const value = input[key];
            if (typeof value === "string" && value.trim()) {
                result[key] = value.trim();
            }
        });
        return result;
    }

    /**
     * 还原 render_controllers，兼容字符串和 {控制器: 条件} 两种客户端写法。
     */
    function parseClientRenderControllers(input) {
        const entries = [];
        const list = Array.isArray(input) ? input : [input];
        list.forEach((item) => {
            if (typeof item === "string" && item.trim()) {
                entries.push({ controller: item.trim(), condition: "" });
                return;
            }
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return;
            }
            Object.keys(item).forEach((controller) => {
                if (!controller.trim()) {
                    return;
                }
                entries.push({
                    controller: controller.trim(),
                    condition: typeof item[controller] === "string" ? item[controller] : "",
                });
            });
        });
        return entries.length ? entries : [{ controller: DEFAULT_RENDER_CONTROLLER, condition: "" }];
    }

    /**
     * 还原 animation_controllers，并跳过系统内置 scale 控制器。
     */
    function parseClientAnimationControllers(input) {
        const entries = [];
        const list = Array.isArray(input) ? input : [input];
        list.forEach((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return;
            }
            Object.keys(item).forEach((key) => {
                const controller = item[key];
                if (!key || key === SYSTEM_SCALE_CONTROLLER_KEY || controller === SYSTEM_SCALE_CONTROLLER_NAME) {
                    return;
                }
                if (typeof controller === "string" && controller.trim()) {
                    entries.push({ key: key.trim(), controller: controller.trim() });
                }
            });
        });
        return entries;
    }

    /**
     * 把 geo.json 内部每个 geometry identifier 建索引，解决文件名和 identifier 不一致的问题。
     */
    function registerResourcePackGeometryFile(context, file, logicalPath, json) {
        const geometries = Array.isArray(json && json["minecraft:geometry"])
            ? json["minecraft:geometry"]
            : [];
        geometries.forEach((geometryItem, index) => {
            const identifier = geometryItem
                && geometryItem.description
                && typeof geometryItem.description.identifier === "string"
                ? geometryItem.description.identifier.trim()
                : "";
            if (!identifier) {
                return;
            }
            const key = normalizeImportLookupKey(identifier);
            if (!context.geometryByIdentifier.has(key)) {
                context.geometryByIdentifier.set(key, {
                    file,
                    logicalPath,
                    sourceName: getFileNameFromPath(logicalPath),
                    json,
                    geometryItem,
                    geometryIndex: index,
                    identifier,
                });
            }
        });
    }

    /**
     * 把 animation.json 内部每个 animation 名建索引，导入时按客户端实体引用反查文件。
     */
    function registerResourcePackAnimationFile(context, file, logicalPath, json) {
        const animations = json && json.animations && typeof json.animations === "object"
            ? json.animations
            : {};
        const animationNames = Object.keys(animations);
        const record = {
            file,
            logicalPath,
            sourceName: getFileNameFromPath(logicalPath),
            json,
            animationNames,
        };
        animationNames.forEach((animationName) => {
            const key = normalizeImportLookupKey(animationName);
            if (!context.animationByName.has(key)) {
                context.animationByName.set(key, record);
            }
        });
    }

    /**
     * 贴图只按资源包路径建索引，真正读取 ArrayBuffer 放到用户确认导入之后。
     */
    function registerResourcePackTextureFile(context, file, logicalPath) {
        const key = normalizeResourcePackAssetPath(logicalPath).toLowerCase();
        if (!context.textureByPath.has(key)) {
            context.textureByPath.set(key, {
                file,
                logicalPath,
                sourceName: getFileNameFromPath(logicalPath),
            });
        }
    }

    /**
     * 弹出轻量选择框，让用户决定导入哪些客户端实体。
     */
    function chooseResourcePackCandidates(candidates) {
        if (candidates.length === 1) {
            const candidate = candidates[0];
            const confirmed = window.confirm(`发现 1 个实体：${candidate.baseName}\n\n是否导入？`);
            return confirmed ? [candidate] : [];
        }

        const lines = candidates.slice(0, 80).map((candidate, index) => {
            const geometryCount = Object.keys(candidate.geometryRefs).length;
            const textureCount = Object.keys(candidate.textureRefs).length;
            const animationCount = countImportableAnimationRefs(candidate.animationRefs);
            return `${index + 1}. ${candidate.baseName} | ${candidate.identifier} | 模型${geometryCount}/贴图${textureCount}/动作${animationCount}`;
        });
        const overflowText = candidates.length > 80 ? `\n... 还有 ${candidates.length - 80} 个未显示，仍可输入序号导入。` : "";
        const answer = window.prompt(
            `扫描到 ${candidates.length} 个实体。\n输入 all 导入全部，或输入序号/范围，例如 1,3,5-8。\n\n${lines.join("\n")}${overflowText}`,
            "all"
        );
        if (answer === null) {
            return [];
        }

        const indexes = parseResourcePackSelection(answer, candidates.length);
        return indexes.map((index) => candidates[index]).filter(Boolean);
    }

    /**
     * 统计非系统动作引用数量，给导入选择框展示用。
     */
    function countImportableAnimationRefs(animationRefs) {
        return Object.keys(animationRefs || {})
            .filter((key) => !isSystemAnimationRef(key, animationRefs[key]))
            .length;
    }

    /**
     * 解析用户输入的导入序号，支持 all、逗号分隔和范围。
     */
    function parseResourcePackSelection(answer, total) {
        const text = String(answer || "").trim().toLowerCase();
        if (!text || text === "all" || text === "a" || text === "*" || text === "全部") {
            return Array.from({ length: total }, (_item, index) => index);
        }

        const selected = new Set();
        text.split(/[,\s，、]+/).forEach((token) => {
            if (!token) {
                return;
            }
            const rangeMatch = token.match(/^(\d+)-(\d+)$/);
            if (rangeMatch) {
                const start = Number.parseInt(rangeMatch[1], 10);
                const end = Number.parseInt(rangeMatch[2], 10);
                const min = Math.max(1, Math.min(start, end));
                const max = Math.min(total, Math.max(start, end));
                for (let index = min; index <= max; index += 1) {
                    selected.add(index - 1);
                }
                return;
            }

            const number = Number.parseInt(token, 10);
            if (Number.isInteger(number) && number >= 1 && number <= total) {
                selected.add(number - 1);
            }
        });
        return Array.from(selected).sort((left, right) => left - right);
    }

    /**
     * 把一个客户端实体候选导入成编辑器实体，并按原配置连好模型、贴图、动作和控制器。
     */
    async function importResourcePackCandidate(candidate, context) {
        const baseName = ensureUniqueEntityBaseName(candidate.baseName);
        const entity = createEntity(baseName);
        entity.identifier = candidate.identifier || `netease:${baseName}`;
        entity.identifierMode = entity.identifier === `netease:${baseName}` ? "auto" : "manual";
        entity.resourceSubdir = deriveResourcePackSubdir(candidate, context);
        entity.files.textures = [];
        entity.files.geometries = [];
        entity.files.animations = [];

        const missingMessages = [];
        const geometryResourceByKey = importResourcePackGeometries(entity, candidate, context, missingMessages);
        const textureResourceByKey = await importResourcePackTextures(entity, candidate, context, missingMessages);
        const importedAnimationNames = importResourcePackAnimations(entity, candidate, context, missingMessages);

        entity.renderControllers = buildImportedRenderControllerBindings(
            candidate,
            entity,
            geometryResourceByKey,
            textureResourceByKey
        );
        entity.animationControllerBindings = buildImportedAnimationControllerBindings(candidate, importedAnimationNames);

        missingMessages.slice(0, 6).forEach((message) => addMessage(message, "warn"));
        if (missingMessages.length > 6) {
            addMessage(`${candidate.baseName} 还有 ${missingMessages.length - 6} 条资源缺失信息未展示。`, "warn");
        }
        return entity;
    }

    /**
     * 导入候选实体引用的模型资源，并按 geometry key 建立连线用索引。
     */
    function importResourcePackGeometries(entity, candidate, context, missingMessages) {
        const geometryResources = getGeometryResources(entity);
        const resourceByKey = new Map();
        Object.entries(candidate.geometryRefs).forEach(([key, identifier]) => {
            const record = findResourcePackGeometryRecord(context, identifier);
            if (!record) {
                missingMessages.push(`${candidate.baseName} 缺少模型 identifier：${identifier}`);
                return;
            }

            const resource = createGeometryResource({
                resourceKey: ensureUniqueResourceKey(geometryResources.map((item) => item.resourceKey), key),
                sourceName: `${record.sourceName}#${record.identifier}`,
                json: cloneGeometryJsonForImport(record),
            });
            geometryResources.push(resource);
            resourceByKey.set(normalizeResourceKey(key), resource);
        });
        return resourceByKey;
    }

    /**
     * 导入候选实体引用的贴图资源，确认导入后才读取 PNG 内容。
     */
    async function importResourcePackTextures(entity, candidate, context, missingMessages) {
        const textureResources = getTextureResources(entity);
        const resourceByKey = new Map();
        const bufferCache = new Map();
        for (const [key, texturePath] of Object.entries(candidate.textureRefs)) {
            const record = findResourcePackTextureRecord(context, texturePath);
            if (!record) {
                missingMessages.push(`${candidate.baseName} 缺少贴图：${texturePath}`);
                continue;
            }

            const buffer = await readCachedTextureBuffer(record, bufferCache);
            const resource = createTextureResource({
                resourceKey: ensureUniqueResourceKey(textureResources.map((item) => item.resourceKey), key),
                sourceName: record.sourceName,
                buffer,
            });
            textureResources.push(resource);
            resourceByKey.set(normalizeResourceKey(key), resource);
        }
        return resourceByKey;
    }

    /**
     * 导入候选实体引用的动作文件，同一个 animation.json 只导入一份。
     */
    function importResourcePackAnimations(entity, candidate, context, missingMessages) {
        const animationResources = getAnimationResources(entity);
        const importedFilePaths = new Set();
        const importedAnimationNames = new Set();

        Object.entries(candidate.animationRefs).forEach(([key, animationName]) => {
            if (isSystemAnimationRef(key, animationName)) {
                return;
            }
            const record = findResourcePackAnimationRecord(context, animationName);
            if (!record) {
                missingMessages.push(`${candidate.baseName} 缺少动作：${animationName}`);
                return;
            }
            if (!importedFilePaths.has(record.logicalPath)) {
                animationResources.push(createAnimationResource({
                    sourceName: record.sourceName,
                    json: deepClone(record.json),
                    animationNames: record.animationNames,
                }));
                importedFilePaths.add(record.logicalPath);
            }
            importedAnimationNames.add(animationName);
        });

        return importedAnimationNames;
    }

    /**
     * 根据源客户端实体的 render_controllers 生成编辑器渲染控制器绑定。
     */
    function buildImportedRenderControllerBindings(candidate, entity, geometryResourceByKey, textureResourceByKey) {
        const geometryResources = getGeometryResources(entity);
        const textureResources = getTextureResources(entity);
        return candidate.renderControllers.map((entry) => {
            const binding = createRenderControllerBinding({
                controller: entry.controller,
                condition: entry.condition,
            });
            applyImportedRenderResourceMappings(binding, "geometry", geometryResourceByKey, geometryResources);
            applyImportedRenderResourceMappings(binding, "texture", textureResourceByKey, textureResources);
            syncRenderBindingMappings(binding, geometryResources, textureResources);
            return binding;
        });
    }

    /**
     * 给单个渲染控制器按槽位名挂上同名资源，未知控制器则保留所有已导入资源 key。
     */
    function applyImportedRenderResourceMappings(binding, type, resourceByKey, resources) {
        const mappingTarget = type === "geometry" ? binding.geometryMappings : binding.textureMappings;
        const preset = getRenderControllerPreset(binding.controller);
        const keys = preset
            ? (type === "geometry" ? preset.geometryKeys : preset.textureKeys)
            : Array.from(resourceByKey.keys());

        keys.forEach((key) => {
            const resource = resourceByKey.get(normalizeResourceKey(key)) || resources[0] || null;
            if (resource) {
                mappingTarget[key] = resource.id;
            }
        });
    }

    /**
     * 根据源客户端实体的 animation_controllers 生成编辑器动画控制器绑定。
     */
    function buildImportedAnimationControllerBindings(candidate, importedAnimationNames) {
        const importedNameSet = importedAnimationNames || new Set();
        if (!candidate.animationControllers.length) {
            return buildFallbackAnimationControllerBindings(importedNameSet);
        }

        return candidate.animationControllers.map((entry, index) => {
            const presetSlots = getControllerSlots(entry.controller);
            const slotNames = presetSlots.length
                ? presetSlots
                : Object.keys(candidate.animationRefs).filter((key) => !isSystemAnimationRef(key, candidate.animationRefs[key]));
            const mappings = {};
            slotNames.forEach((slotName) => {
                const sourceName = candidate.animationRefs[slotName];
                if (sourceName && importedNameSet.has(sourceName)) {
                    mappings[slotName] = sourceName;
                }
            });

            if (!presetSlots.length) {
                addMessage(`${candidate.baseName} 的动画控制器未收录到 manifest：${entry.controller}`, "warn");
            }

            return createAnimationControllerBinding({
                key: entry.key || (index === 0 ? DEFAULT_ANIMATION_BINDING_KEY : `imported${index + 1}`),
                controller: entry.controller,
                animationMappings: mappings,
            });
        });
    }

    /**
     * 源配置没有声明动画控制器时，退回到编辑器原有推荐控制器逻辑。
     */
    function buildFallbackAnimationControllerBindings(importedAnimationNames) {
        const animationNames = Array.from(importedAnimationNames || []);
        const controller = recommendController(animationNames);
        const slots = getControllerSlots(controller);
        return [
            createAnimationControllerBinding({
                key: DEFAULT_ANIMATION_BINDING_KEY,
                controller,
                animationMappings: buildAnimationMappings({ animationNames }, slots, {}),
            }),
        ];
    }

    /**
     * scale 动作由编辑器固定生成，不允许从资源包导入成可编辑轨道。
     */
    function isSystemAnimationRef(key, animationName) {
        return key === SYSTEM_SCALE_CONTROLLER_KEY || animationName === "animation.entity.auto.scale";
    }

    /**
     * 依据贴图路径优先推导导出子目录，缺失时再尝试模型路径。
     */
    function deriveResourcePackSubdir(candidate, context) {
        const textureSubdir = Object.values(candidate.textureRefs)
            .map((texturePath) => extractSubdirAfterPrefix(normalizeResourcePackAssetPath(texturePath), "textures/entity"))
            .find(Boolean);
        if (textureSubdir) {
            return textureSubdir;
        }

        const geometrySubdir = Object.values(candidate.geometryRefs)
            .map((identifier) => findResourcePackGeometryRecord(context, identifier))
            .filter(Boolean)
            .map((record) => extractSubdirAfterPrefix(record.logicalPath, "models/entity"))
            .find(Boolean);
        return geometrySubdir || DEFAULT_SUBDIR;
    }

    /**
     * 从资源路径中取指定前缀后的第一段目录名。
     */
    function extractSubdirAfterPrefix(path, prefix) {
        const normalizedPath = String(path || "").replace(/\\/g, "/");
        const prefixParts = prefix.split("/").filter(Boolean);
        const parts = normalizedPath.split("/").filter(Boolean);
        for (let index = 0; index <= parts.length - prefixParts.length; index += 1) {
            const matched = prefixParts.every((part, offset) => parts[index + offset] === part);
            if (matched) {
                return parts[index + prefixParts.length] || "";
            }
        }
        return "";
    }

    /**
     * 查找模型 identifier 对应的源 geo 记录。
     */
    function findResourcePackGeometryRecord(context, identifier) {
        return context.geometryByIdentifier.get(normalizeImportLookupKey(identifier)) || null;
    }

    /**
     * 查找贴图路径对应的源 PNG 记录。
     */
    function findResourcePackTextureRecord(context, texturePath) {
        return context.textureByPath.get(normalizeResourcePackAssetPath(texturePath).toLowerCase()) || null;
    }

    /**
     * 查找动作名对应的源 animation.json 记录。
     */
    function findResourcePackAnimationRecord(context, animationName) {
        return context.animationByName.get(normalizeImportLookupKey(animationName)) || null;
    }

    /**
     * 为导入模型创建只包含目标 geometry 的 geo.json 副本，避免把同文件其他模型一起塞进实体。
     */
    function cloneGeometryJsonForImport(record) {
        return {
            format_version: record.json.format_version || "1.12.0",
            "minecraft:geometry": [
                deepClone(record.geometryItem),
            ],
        };
    }

    /**
     * 读取贴图 ArrayBuffer，并在单个实体导入过程中复用同一路径的读取结果。
     */
    async function readCachedTextureBuffer(record, bufferCache) {
        if (!bufferCache.has(record.logicalPath)) {
            bufferCache.set(record.logicalPath, await record.file.arrayBuffer());
        }
        return bufferCache.get(record.logicalPath);
    }

    /**
     * 资源包资源路径统一去掉后缀和外层目录，方便和 client entity 引用互相匹配。
     */
    function normalizeResourcePackAssetPath(value) {
        const rawPath = String(value || "")
            .trim()
            .replace(/\\/g, "/")
            .replace(/^\/+/, "")
            .replace(/\.png$/i, "");
        const parts = rawPath.split("/").filter(Boolean);
        const rootSegments = ["textures", "models", "animations", "entity"];
        const rootIndex = parts.findIndex((segment) => rootSegments.includes(segment));
        return rootIndex >= 0 ? parts.slice(rootIndex).join("/") : parts.join("/");
    }

    /**
     * identifier 和 animation 名按大小写不敏感匹配，兼容 Windows 资源包常见大小写差异。
     */
    function normalizeImportLookupKey(value) {
        return String(value || "").trim().toLowerCase();
    }

    /**
     * 从路径中提取文件名。
     */
    function getFileNameFromPath(path) {
        const parts = String(path || "").replace(/\\/g, "/").split("/").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : "";
    }

    /**
     * 导入同名实体时自动追加后缀，避免覆盖当前编辑器已有内容。
     */
    function ensureUniqueEntityBaseName(baseName) {
        const normalized = normalizeImportedBaseName(baseName || "imported_entity");
        if (!findEntityByBaseName(normalized)) {
            return normalized;
        }

        let index = 2;
        let nextName = `${normalized}_${index}`;
        while (findEntityByBaseName(nextName)) {
            index += 1;
            nextName = `${normalized}_${index}`;
        }
        return nextName;
    }

    /**
     * 为导出构建骨骼隔离上下文：跨模型重名骨骼会被改名，业务 root 也会避让包装 root。
     */
    function buildGeometryBoneIsolationContext(entity) {
        const geometryResources = getGeometryResources(entity);
        const shouldIsolateSharedBones = isBoneIsolationEnabled(entity);
        const boneOwners = new Map();
        const usedBoneNames = new Set();

        geometryResources.forEach((resource) => {
            const resourceKey = resource.resourceKey;
            const boneNames = collectGeometryResourceBoneNames(resource);
            boneNames.forEach((boneName) => {
                usedBoneNames.add(boneName);
                if (!boneOwners.has(boneName)) {
                    boneOwners.set(boneName, []);
                }
                boneOwners.get(boneName).push(resourceKey);
            });
        });

        const renameMapsByResourceKey = new Map();
        const conflictRecords = [];
        boneOwners.forEach((owners, boneName) => {
            const uniqueOwners = [...new Set(owners)];
            if (boneName !== "root" && uniqueOwners.length <= 1) {
                return;
            }
            if (boneName !== "root" && !shouldIsolateSharedBones) {
                return;
            }

            const preservedOwner = boneName === "root" ? "" : choosePreservedBoneOwner(uniqueOwners);
            const renamedOwners = uniqueOwners.filter((resourceKey) => resourceKey !== preservedOwner);
            if (boneName !== "root" && renamedOwners.length) {
                conflictRecords.push({ boneName, owners: uniqueOwners });
            }

            renamedOwners.forEach((resourceKey) => {
                const renameMap = getOrCreateBoneRenameMap(renameMapsByResourceKey, resourceKey);
                const nextName = buildUniqueNamespacedBoneName(resourceKey, boneName, usedBoneNames);
                renameMap.set(boneName, nextName);
                usedBoneNames.add(nextName);
            });
        });

        return {
            renameMapsByResourceKey,
            conflictRecords,
            warnings: buildBoneIsolationWarnings(conflictRecords, renameMapsByResourceKey),
        };
    }

    /**
     * 收集单个模型资源里出现过的所有骨骼名。
     */
    function collectGeometryResourceBoneNames(resource) {
        const boneNames = new Set();
        if (!resource || !resource.json || typeof resource.json !== "object") {
            return boneNames;
        }

        const geometries = Array.isArray(resource.json["minecraft:geometry"])
            ? resource.json["minecraft:geometry"]
            : [];
        geometries.forEach((geometryItem) => {
            if (!geometryItem || !Array.isArray(geometryItem.bones)) {
                return;
            }
            geometryItem.bones.forEach((bone) => {
                if (bone && typeof bone.name === "string" && bone.name.trim()) {
                    boneNames.add(bone.name.trim());
                }
            });
        });
        return boneNames;
    }

    /**
     * 同名骨骼冲突时优先保留 default 模型，其它模型改名以减少对本体动作的影响。
     */
    function choosePreservedBoneOwner(resourceKeys) {
        if (resourceKeys.includes("default")) {
            return "default";
        }
        return [...resourceKeys].sort(compareSlotNames)[0] || "";
    }

    /**
     * 取出某个模型资源的骨骼改名表，不存在时创建。
     */
    function getOrCreateBoneRenameMap(renameMapsByResourceKey, resourceKey) {
        if (!renameMapsByResourceKey.has(resourceKey)) {
            renameMapsByResourceKey.set(resourceKey, new Map());
        }
        return renameMapsByResourceKey.get(resourceKey);
    }

    /**
     * 生成不会和现有骨骼名冲突的命名空间骨骼名。
     */
    function buildUniqueNamespacedBoneName(resourceKey, boneName, usedBoneNames) {
        const safeResourceKey = normalizeBoneNamePart(resourceKey);
        const safeBoneName = normalizeBoneNamePart(boneName);
        const baseName = `${BONE_NAMESPACE_PREFIX}_${safeResourceKey}_${safeBoneName}`;
        let nextName = baseName;
        let suffix = 2;
        while (usedBoneNames.has(nextName) || nextName === "root") {
            nextName = `${baseName}_${suffix}`;
            suffix += 1;
        }
        return nextName;
    }

    /**
     * 把资源 key 或骨骼名压成适合拼接的新骨骼名片段。
     */
    function normalizeBoneNamePart(value) {
        const normalized = String(value || "")
            .trim()
            .replace(/[^A-Za-z0-9_]+/g, "_")
            .replace(/^_+|_+$/g, "");
        return normalized || "bone";
    }

    /**
     * 生成骨骼隔离提示，帮助用户知道哪些模型会在导出时自动改名。
     */
    function buildBoneIsolationWarnings(conflictRecords, renameMapsByResourceKey) {
        const warnings = [];
        conflictRecords.forEach((record) => {
            const changedOwners = record.owners
                .filter((resourceKey) => {
                    const renameMap = renameMapsByResourceKey.get(resourceKey);
                    return renameMap && renameMap.has(record.boneName);
                })
                .map((resourceKey) => `${resourceKey}:${renameMapsByResourceKey.get(resourceKey).get(record.boneName)}`);
            if (changedOwners.length) {
                warnings.push(`骨骼 ${record.boneName} 同时存在于 ${record.owners.join("、")}，导出时会隔离为 ${changedOwners.join("、")}。`);
            }
        });
        return warnings;
    }

    /**
     * 按改名表同步改写模型骨骼名和 parent 指向。
     */
    function renameGeometryBones(geometryItem, renameMap) {
        if (!renameMap || !renameMap.size || !geometryItem || !Array.isArray(geometryItem.bones)) {
            return;
        }

        geometryItem.bones.forEach((bone) => {
            if (!bone || typeof bone !== "object") {
                return;
            }
            if (typeof bone.name === "string" && renameMap.has(bone.name)) {
                bone.name = renameMap.get(bone.name);
            }
            if (typeof bone.parent === "string" && renameMap.has(bone.parent)) {
                bone.parent = renameMap.get(bone.parent);
            }
        });
    }

    /**
     * 导出 geometry 时强制补一个最外层包装 `root`，专门给整体缩放动画使用。
     */
    function wrapGeometryBonesWithRoot(geometryItem) {
        if (!geometryItem || !Array.isArray(geometryItem.bones)) {
            return;
        }

        const bones = geometryItem.bones
            .filter((bone) => bone && typeof bone === "object" && typeof bone.name === "string" && bone.name.trim());
        if (!bones.length) {
            geometryItem.bones = bones;
            return;
        }

        bones.forEach((bone) => {
            if (bone.name === "root") {
                return;
            }
            if (typeof bone.parent === "string" && bone.parent.trim()) {
                return;
            }
            bone.parent = "root";
        });

        geometryItem.bones = [{
            name: "root",
            pivot: [0, 0, 0],
        }].concat(bones);
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
            const resources = getAnimationResources(entity);
            const existing = assignment && assignment.resourceId
                ? findAnimationResource(entity, assignment.resourceId)
                : null;

            if (existing) {
                existing.sourceName = detected.file.name;
                existing.json = detected.json;
                existing.animationNames = [...detected.animationNames];
            } else {
                resources.push(createAnimationResource({
                    sourceName: detected.file.name,
                    json: detected.json,
                    animationNames: detected.animationNames,
                }));
            }

            refreshAnimationBindings(entity);
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

    /**
     * 导出当前编辑器兼容的 use_controllers 内容，方便用户单独下载最新控制器资源。
     */
    async function exportUseControllersZip() {
        if (typeof window.JSZip === "undefined") {
            addMessage("JSZip 未加载，当前无法导出控制器 ZIP。", "error");
            render();
            return;
        }

        try {
            const zip = new window.JSZip();
            const controllerFiles = collectUseControllerFiles();
            if (!controllerFiles.length) {
                addMessage("当前没有可导出的控制器文件。", "warn");
                render();
                return;
            }

            for (const fileInfo of controllerFiles) {
                const content = await resolveUseControllerFileContent(fileInfo);
                zip.file(fileInfo.zipPath, content);
            }

            const blob = await zip.generateAsync({ type: "blob" });
            const downloadName = `betterappearance-use-controllers-${createTimestamp()}.zip`;
            downloadBlob(blob, downloadName);
            setStatus(`已导出控制器：${downloadName}`);
            addMessage(`已导出 ${controllerFiles.length} 个 use_controllers 文件。`, "info");
        } catch (error) {
            addMessage(`导出控制器失败：${error.message}`, "error");
        }
        render();
    }

    /**
     * 按当前 manifest 收录内容整理需要打包的控制器文件路径。
     */
    function collectUseControllerFiles() {
        const fileMap = new Map();

        CONTROLLER_DATA.animationControllers.forEach((entry) => {
            if (!entry || !entry.source) {
                return;
            }
            const relativePath = `use_controllers/animation_controllers/entity/${entry.source}`;
            fileMap.set(relativePath, {
                zipPath: relativePath,
            });
        });

        CONTROLLER_DATA.renderControllers.forEach((entry) => {
            if (!entry || !entry.source) {
                return;
            }
            const relativePath = `use_controllers/render_controllers/${entry.source}`;
            fileMap.set(relativePath, {
                zipPath: relativePath,
            });
        });

        if (Array.isArray(CONTROLLER_DATA.controllerFiles)) {
            CONTROLLER_DATA.controllerFiles.forEach((file) => {
                if (!file || typeof file.path !== "string") {
                    return;
                }

                const existing = fileMap.get(file.path) || { zipPath: file.path };
                if (typeof file.content === "string") {
                    existing.embeddedContent = file.content;
                }
                fileMap.set(file.path, existing);
            });
        }

        return Array.from(fileMap.values()).sort((left, right) => left.zipPath.localeCompare(right.zipPath));
    }

    /**
     * 按当前打开方式选择控制器内容来源：
     * HTTP 场景优先读实时文件，file:// 场景优先读内嵌内容，两边都保留回退。
     */
    async function resolveUseControllerFileContent(fileInfo) {
        const relativePath = `./${fileInfo.zipPath}`;
        const embeddedContent = typeof fileInfo.embeddedContent === "string"
            ? fileInfo.embeddedContent
            : null;

        if (shouldPreferRuntimeControllerFiles()) {
            try {
                return await readRelativeTextFile(relativePath);
            } catch (error) {
                if (embeddedContent !== null) {
                    return embeddedContent;
                }
                throw error;
            }
        }

        if (embeddedContent !== null) {
            return embeddedContent;
        }

        return await readRelativeTextFile(relativePath);
    }

    /**
     * 判断当前是否应该优先读取目录中的真实文件。
     */
    function shouldPreferRuntimeControllerFiles() {
        return getCurrentProtocol() !== "file:";
    }

    /**
     * 统一获取页面协议，避免旧环境下直接访问 location 时报错。
     */
    function getCurrentProtocol() {
        if (!window.location || typeof window.location.protocol !== "string") {
            return "";
        }
        return window.location.protocol.toLowerCase();
    }

    /**
     * 读取编辑器目录下的文本文件；主要给 HTTP 场景读取最新控制器内容使用。
     */
    async function readRelativeTextFile(relativePath) {
        const response = await fetch(relativePath, { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`读取文件失败：${relativePath}`);
        }
        return await response.text();
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
            if (!Number.isFinite(entityProfile.opacity) || entityProfile.opacity < 0 || entityProfile.opacity > 1) {
                errors.push({ entityId: entity.id, message: `${name} 的实体透明度必须在 0 到 1 之间。` });
            }
            if (!isValidRenderGain(entityProfile.redGain)) {
                errors.push({ entityId: entity.id, message: `${name} 的红色通道增益必须在 0 到 16 之间。` });
            }
            if (!isValidRenderGain(entityProfile.greenGain)) {
                errors.push({ entityId: entity.id, message: `${name} 的绿色通道增益必须在 0 到 16 之间。` });
            }
            if (!isValidRenderGain(entityProfile.blueGain)) {
                errors.push({ entityId: entity.id, message: `${name} 的蓝色通道增益必须在 0 到 16 之间。` });
            }
            if (!isValidRenderGain(entityProfile.brightness)) {
                errors.push({ entityId: entity.id, message: `${name} 的整体亮度必须在 0 到 16 之间。` });
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
            if (!getAnimationResources(entity).length) {
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
            if (getAnimationResources(entity).length && !mergedAnimationData.entries.length) {
                errors.push({ entityId: entity.id, message: `${name} 没有可导出的动作槽位映射。` });
            }
        }
        return dedupeErrors(errors);
    }

    function buildNormalizedPayload(entity) {
        const boneIsolationContext = buildGeometryBoneIsolationContext(entity);
        const geometryJson = normalizeGeometryJson(entity, boneIsolationContext);
        const animationJson = normalizeAnimationJson(entity, boneIsolationContext);
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

    function normalizeGeometryJson(entity, boneIsolationContext) {
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
                renameGeometryBones(item, getBoneRenameMapForResource(boneIsolationContext, resource.resourceKey));
                wrapGeometryBonesWithRoot(item);
                mergedGeometries.push(item);
            });
        });

        return {
            format_version: formatVersion,
            "minecraft:geometry": mergedGeometries,
        };
    }

    function normalizeAnimationJson(entity, boneIsolationContext) {
        const mergedAnimationFile = getMergedAnimationFile(entity);
        const baseJson = deepClone(mergedAnimationFile.json);
        const renamedAnimations = {};
        const sourceAnimations = mergedAnimationFile.json.animations || {};

        createAnimateList(entity).forEach((entry) => {
            if (!entry.sourceName || !sourceAnimations[entry.sourceName]) {
                return;
            }
            renamedAnimations[entry.name] = deepClone(sourceAnimations[entry.sourceName]);
            renameAnimationBones(
                renamedAnimations[entry.name],
                getBoneRenameMapForResource(boneIsolationContext, entry.targetGeometryKey)
            );
        });

        baseJson.animations = renamedAnimations;
        if (!baseJson.format_version) {
            baseJson.format_version = "1.8.0";
        }
        padScaleTracksToLinearTail(baseJson);
        return baseJson;
    }

    /**
     * 获取某个模型资源对应的骨骼改名表，没有改名需求时返回空表。
     */
    function getBoneRenameMapForResource(boneIsolationContext, resourceKey) {
        if (!boneIsolationContext || !boneIsolationContext.renameMapsByResourceKey) {
            return new Map();
        }
        return boneIsolationContext.renameMapsByResourceKey.get(resourceKey) || new Map();
    }

    /**
     * 按目标模型资源的改名表同步改写动画 bones 轨道名。
     */
    function renameAnimationBones(animationBody, renameMap) {
        if (!renameMap || !renameMap.size || !animationBody || typeof animationBody !== "object") {
            return;
        }

        const bones = animationBody.bones;
        if (!bones || typeof bones !== "object" || Array.isArray(bones)) {
            return;
        }

        Object.keys(bones).forEach((boneName) => {
            if (!renameMap.has(boneName)) {
                return;
            }
            const nextName = renameMap.get(boneName);
            if (!nextName || nextName === boneName) {
                return;
            }
            bones[nextName] = bones[boneName];
            delete bones[boneName];
        });
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
            materials[key] = "entity_alpha_control_lit";
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
            .map((binding) => createClientRenderControllerEntry(binding))
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

    /**
     * 客户端 render_controllers 支持两种写法：无条件用字符串，有条件用 { 控制器: 条件 }。
     */
    function createClientRenderControllerEntry(binding) {
        const controller = String(binding.controller || "").trim();
        const condition = String(binding.condition || "").trim();
        if (!controller) {
            return null;
        }
        if (!condition) {
            return controller;
        }
        return {
            [controller]: condition,
        };
    }

    function createAnimateList(entity) {
        return getMergedAnimationEntries(entity).entries.map((entry) => ({
            key: entry.key,
            name: entry.name,
            sourceName: entry.sourceName,
            targetGeometryKey: entry.targetGeometryKey,
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

        if (hasCustomRenderEntityProfile(entity)) {
            lines.push("    # 渲染通道：red/green/blue/alpha 乘最终颜色，brightness 控制整体亮度");
            lines.push("    render:");
            getChangedRenderEntityProfileEntries(entityProfile).forEach((entry) => {
                lines.push(`      ${entry.key}: ${entry.value}`);
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
     * 判断实体是否改动了任意渲染通道字段。
     */
    function hasCustomRenderEntityProfile(entity) {
        const entityProfile = getEntityProfile(entity);
        return entityProfile.opacity !== DEFAULT_ENTITY_PROFILE.opacity
            || entityProfile.redGain !== DEFAULT_ENTITY_PROFILE.redGain
            || entityProfile.greenGain !== DEFAULT_ENTITY_PROFILE.greenGain
            || entityProfile.blueGain !== DEFAULT_ENTITY_PROFILE.blueGain
            || entityProfile.brightness !== DEFAULT_ENTITY_PROFILE.brightness
            || entityProfile.ignoreLight !== DEFAULT_ENTITY_PROFILE.ignoreLight;
    }

    /**
     * 只导出偏离默认值的 render 子字段，避免生成冗余配置。
     */
    function getChangedRenderEntityProfileEntries(entityProfile) {
        const entries = [];
        if (entityProfile.redGain !== DEFAULT_ENTITY_PROFILE.redGain) {
            entries.push({ key: "red", value: String(entityProfile.redGain) });
        }
        if (entityProfile.greenGain !== DEFAULT_ENTITY_PROFILE.greenGain) {
            entries.push({ key: "green", value: String(entityProfile.greenGain) });
        }
        if (entityProfile.blueGain !== DEFAULT_ENTITY_PROFILE.blueGain) {
            entries.push({ key: "blue", value: String(entityProfile.blueGain) });
        }
        if (entityProfile.opacity !== DEFAULT_ENTITY_PROFILE.opacity) {
            entries.push({ key: "alpha", value: String(entityProfile.opacity) });
        }
        if (entityProfile.brightness !== DEFAULT_ENTITY_PROFILE.brightness) {
            entries.push({ key: "brightness", value: String(entityProfile.brightness) });
        }
        if (entityProfile.ignoreLight !== DEFAULT_ENTITY_PROFILE.ignoreLight) {
            entries.push({ key: "ignoreLight", value: String(Boolean(entityProfile.ignoreLight)) });
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
     * 校验渲染通道增益，和服务端 profile 上限保持一致。
     */
    function isValidRenderGain(value) {
        return Number.isFinite(value) && value >= 0 && value <= 16;
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

    function bindEntityProfileInput(input, entity, key, fallback, rerender = render) {
        if (!input) {
            return;
        }

        input.addEventListener("input", (event) => {
            entity.entityProfile[key] = parseEntityProfileValue(event.target.value, fallback);
        });

        input.addEventListener("change", (event) => {
            entity.entityProfile[key] = parseEntityProfileValue(event.target.value, fallback);
            event.target.value = String(entity.entityProfile[key]);
            rerender();
        });
    }

    /**
     * 绑定实体透明度输入框，透明度固定限制在 0..1。
     */
    function bindEntityProfileOpacityInput(input, entity, rerender = render) {
        if (!input) {
            return;
        }

        input.addEventListener("input", (event) => {
            entity.entityProfile.opacity = parseColorAlpha(event.target.value, DEFAULT_ENTITY_PROFILE.opacity);
        });

        input.addEventListener("change", (event) => {
            entity.entityProfile.opacity = parseColorAlpha(event.target.value, DEFAULT_ENTITY_PROFILE.opacity);
            event.target.value = formatColorUnit(entity.entityProfile.opacity);
            rerender();
        });
    }

    /**
     * 绑定整数型实体 profile 输入框，保证值始终不低于配置要求。
     */
    function bindEntityProfileIntegerInput(input, entity, key, fallback, minValue, rerender = render) {
        if (!input) {
            return;
        }

        input.addEventListener("input", (event) => {
            entity.entityProfile[key] = parseEntityProfileIntegerValue(event.target.value, fallback, minValue);
        });

        input.addEventListener("change", (event) => {
            entity.entityProfile[key] = parseEntityProfileIntegerValue(event.target.value, fallback, minValue);
            event.target.value = String(entity.entityProfile[key]);
            rerender();
        });
    }

    /**
     * 绑定布尔型实体 profile 下拉框，直接同步到当前实体。
     */
    function bindEntityProfileBooleanSelect(select, entity, key) {
        if (!select) {
            return;
        }

        select.addEventListener("change", (event) => {
            entity.entityProfile[key] = event.target.value === "true";
            renderOutputPreview();
        });
    }

    /**
     * 绑定标题 profile 的普通文本输入框。
     */
    function bindTitleProfileInput(input, entity, key, rerender = render) {
        if (!input) {
            return;
        }

        input.addEventListener("input", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
        });

        input.addEventListener("change", (event) => {
            getEntityTitleProfile(entity)[key] = event.target.value;
            rerender();
        });
    }

    /**
     * 绑定标题 profile 的深度测试下拉框。
     */
    function bindTitleDepthTestSelect(select, entity, rerender = render) {
        if (!select) {
            return;
        }

        select.addEventListener("change", (event) => {
            getEntityTitleProfile(entity).depthTest = parseOptionalBoolean(event.target.value);
            rerender();
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
            const animationCount = getAnimationResources(entity).length;
            const chips = [
                textureCount ? `贴图${textureCount}` : null,
                geometryCount ? `模型${geometryCount}` : null,
                animationCount ? `动作${animationCount}` : null,
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
        const animationResources = getAnimationResources(entity);
        const mergedAnimationFile = getMergedAnimationFile(entity);
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
        const availableAnimations = mergedAnimationFile ? mergedAnimationFile.animationNames : [];
        const usedAnimationNames = getUsedAnimationSourceNames(entity);
        const unusedAnimations = availableAnimations.filter((name) => !usedAnimationNames.has(name));
        const detailMode = getEntityDetailMode(entity);
        const inspectorModeSwitchHtml = renderInspectorModeSwitch(detailMode);

        const legacyInspectorHtml = `
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
                        <label for="boneIsolationEnabledSelect">普通同名骨骼隔离</label>
                        <select id="boneIsolationEnabledSelect">
                            <option value="true" ${isBoneIsolationEnabled(entity) ? "selected" : ""}>开启</option>
                            <option value="false" ${!isBoneIsolationEnabled(entity) ? "selected" : ""}>关闭</option>
                        </select>
                        <p class="field-hint">开启后导出时自动隔离跨模型同名骨骼；关闭只保留 root 包装避让。</p>
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
                                                    <label for="profileOpacityInput">实体透明度</label>
                                                    <input id="profileOpacityInput" type="number" min="0" max="1" step="any" value="${escapeAttribute(entityProfile.opacity)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，范围 <code>0..1</code>，会导出为 <code>render.alpha</code>。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileRedGainInput">红色通道增益</label>
                                                    <input id="profileRedGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.redGain)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，最终颜色的 R 通道会乘以该值。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileGreenGainInput">绿色通道增益</label>
                                                    <input id="profileGreenGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.greenGain)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，最终颜色的 G 通道会乘以该值。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileBlueGainInput">蓝色通道增益</label>
                                                    <input id="profileBlueGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.blueGain)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，最终颜色的 B 通道会乘以该值。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileBrightnessInput">整体亮度</label>
                                                    <input id="profileBrightnessInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.brightness)}">
                                                    <p class="field-hint">默认值为 <code>1</code>，在环境光计算前乘到 RGB。</p>
                                                </div>
                                                <div class="field">
                                                    <label for="profileIgnoreLightSelect">忽略环境光</label>
                                                    <select id="profileIgnoreLightSelect">
                                                        <option value="false" ${!entityProfile.ignoreLight ? "selected" : ""}>false</option>
                                                        <option value="true" ${entityProfile.ignoreLight ? "selected" : ""}>true</option>
                                                    </select>
                                                    <p class="field-hint">为 <code>true</code> 时跳过环境光乘法，但仍保留雾效。</p>
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
                <div class="detail-actions">
                    <h3>动作资源</h3>
                    <button class="button ghost" type="button" data-action="add-animation-resource">新增动作资源</button>
                </div>
                <div class="file-stack">
                    ${animationResources.length
                        ? animationResources.map((resource) => renderAnimationResourceFileCard(resource)).join("")
                        : '<p class="empty-state">还没有动作资源。</p>'}
                </div>
                <p class="field-hint">多个动作资源会在导出时自动合并成一个最终的 <code>${escapeHtml(entity.baseName || "实体名")}.animation.json</code>。</p>
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

            ${renderBoneIsolationWarningSectionHtml(entity)}

        `;

        elements.inspector.innerHTML = detailMode === "graph"
            ? `${inspectorModeSwitchHtml}${renderConnectionBoardHtml(entity, {
                renderControllerBindings,
                animationControllerBindings,
                textureResources,
                geometryResources,
                animationResources,
                availableAnimations,
                mergedAnimationData,
                unusedAnimations,
                entityProfile,
                titleProfile,
                titleTextColorState,
                titleBackgroundColorState,
                titleDepthTestValue,
                renderBindings,
                animationSlotNames,
            })}`
            : `${inspectorModeSwitchHtml}${legacyInspectorHtml}`;

        bindInspectorModeEvents(entity);
        if (detailMode === "graph") {
            bindConnectionBoardEvents(entity);
            window.requestAnimationFrame(drawConnectionBoardLines);
            return;
        }
        bindInspectorEvents(entity);
    }

    /**
     * 获取实体详情页模式；新数据默认进入连连看，旧表单只作为可切换入口保留。
     */
    function getEntityDetailMode(entity) {
        if (entity.detailMode === "legacy") {
            return "legacy";
        }
        entity.detailMode = "graph";
        return entity.detailMode;
    }

    /**
     * 渲染详情页模式切换按钮，避免新旧两套编辑入口互相抢位置。
     */
    function renderInspectorModeSwitch(detailMode) {
        return `
            <section class="section-card inspector-mode-card">
                <div>
                    <h3>实体详情编辑方式</h3>
                    <p class="field-hint">连连看负责资源装配和细项配置；旧表单仅作为兼容入口保留。</p>
                </div>
                <div class="inspector-mode-switch">
                    <button class="button secondary ${detailMode === "graph" ? "is-active" : ""}" type="button" data-inspector-mode="graph">连连看</button>
                    <button class="button ghost ${detailMode === "legacy" ? "is-active" : ""}" type="button" data-inspector-mode="legacy">旧表单</button>
                </div>
            </section>
        `;
    }

    /**
     * 渲染服务端 profile 细项，连连看和旧表单都写回同一份 entityProfile。
     */
    function renderEntityProfileSectionHtml(entityProfile) {
        return `
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
                        <label for="profileOpacityInput">实体透明度</label>
                        <input id="profileOpacityInput" type="number" min="0" max="1" step="any" value="${escapeAttribute(entityProfile.opacity)}">
                        <p class="field-hint">默认值为 <code>1</code>，范围 <code>0..1</code>，会导出为 <code>render.alpha</code>。</p>
                    </div>
                    <div class="field">
                        <label for="profileRedGainInput">红色通道增益</label>
                        <input id="profileRedGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.redGain)}">
                        <p class="field-hint">默认值为 <code>1</code>，最终颜色的 R 通道会乘以该值。</p>
                    </div>
                    <div class="field">
                        <label for="profileGreenGainInput">绿色通道增益</label>
                        <input id="profileGreenGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.greenGain)}">
                        <p class="field-hint">默认值为 <code>1</code>，最终颜色的 G 通道会乘以该值。</p>
                    </div>
                    <div class="field">
                        <label for="profileBlueGainInput">蓝色通道增益</label>
                        <input id="profileBlueGainInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.blueGain)}">
                        <p class="field-hint">默认值为 <code>1</code>，最终颜色的 B 通道会乘以该值。</p>
                    </div>
                    <div class="field">
                        <label for="profileBrightnessInput">整体亮度</label>
                        <input id="profileBrightnessInput" type="number" min="0" max="16" step="any" value="${escapeAttribute(entityProfile.brightness)}">
                        <p class="field-hint">默认值为 <code>1</code>，在环境光计算前乘到 RGB。</p>
                    </div>
                    <div class="field">
                        <label for="profileIgnoreLightSelect">忽略环境光</label>
                        <select id="profileIgnoreLightSelect">
                            <option value="false" ${!entityProfile.ignoreLight ? "selected" : ""}>false</option>
                            <option value="true" ${entityProfile.ignoreLight ? "selected" : ""}>true</option>
                        </select>
                        <p class="field-hint">为 <code>true</code> 时跳过环境光乘法，但仍保留雾效。</p>
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
            </section>
        `;
    }

    /**
     * 渲染头顶标题 profile，颜色编辑器仍复用原有色盘和 RGBA 输入逻辑。
     */
    function renderTitleProfileSectionHtml(titleProfile, titleTextColorState, titleBackgroundColorState, titleDepthTestValue) {
        return `
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
        `;
    }

    /**
     * 渲染资源明细区，把旧表单里的替换和移除入口搬到连连看下方。
     */
    function renderResourceDetailSectionsHtml(entity, textureResources, geometryResources, animationResources) {
        return `
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
                <div class="detail-actions">
                    <h3>动作资源</h3>
                    <button class="button ghost" type="button" data-action="add-animation-resource">新增动作资源</button>
                </div>
                <div class="file-stack">
                    ${animationResources.length
                        ? animationResources.map((resource) => renderAnimationResourceFileCard(resource)).join("")
                        : '<p class="empty-state">还没有动作资源。</p>'}
                </div>
                <p class="field-hint">多个动作资源会在导出时自动合并成一个最终的 <code>${escapeHtml(entity.baseName || "实体名")}.animation.json</code>。</p>
            </section>
        `;
    }

    /**
     * 渲染控制器 key 参考，方便在连连看里直接核对最终导出的槽位。
     */
    function renderControllerKeyReferenceSectionHtml(renderBindings, animationSlotNames) {
        return `
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
        `;
    }

    /**
     * 渲染未使用动作列表，帮助检查导入动作是否都被连到控制器槽位。
     */
    function renderUnusedAnimationsSectionHtml(unusedAnimations) {
        return `
            <section class="section-card">
                <h3>未使用动作</h3>
                ${unusedAnimations.length ? `<div class="chip-row">${unusedAnimations.map((name) => `<span class="chip muted">${escapeHtml(name)}</span>`).join("")}</div>` : '<p class="field-hint">当前动作文件中的动画块都已被控制器映射使用。</p>'}
            </section>
        `;
    }

    /**
     * 绑定详情页模式切换，模式只影响编辑器 UI，不参与导出协议。
     */
    function bindInspectorModeEvents(entity) {
        elements.inspector.querySelectorAll("[data-inspector-mode]").forEach((button) => {
            button.addEventListener("click", () => {
                entity.detailMode = button.dataset.inspectorMode === "legacy" ? "legacy" : "graph";
                render();
            });
        });
    }

    /**
     * 渲染连连看编辑器主界面，所有连线最终仍然写回原有映射字段。
     */
    function renderConnectionBoardHtml(entity, context) {
        const geometryNodes = context.geometryResources.map((resource) => ({
            nodeId: getGraphNodeId("geometry", resource.id),
            title: resource.resourceKey,
            subtitle: resource.sourceName || "未命名模型",
            type: "geometry",
            resourceId: resource.id,
            animationName: "",
        }));
        const textureNodes = context.textureResources.map((resource) => ({
            nodeId: getGraphNodeId("texture", resource.id),
            title: resource.resourceKey,
            subtitle: resource.sourceName || "未命名贴图",
            type: "texture",
            resourceId: resource.id,
            animationName: "",
        }));
        const animationNodes = context.availableAnimations.map((animationName) => ({
            nodeId: getGraphNodeId("animation", animationName),
            title: animationName,
            subtitle: findAnimationSourceNameByAnimationName(entity, animationName) || "合并动作文件",
            type: "animation",
            resourceId: "",
            animationName,
        }));

        return `
            <div class="detail-actions">
                <button class="button ghost" type="button" data-action="duplicate-entity">复制当前实体</button>
                <button class="button danger" type="button" data-action="delete-entity">删除当前实体</button>
            </div>

            <section class="section-card graph-basic-card">
                <div class="form-grid">
                    <div class="field">
                        <label for="graphBaseNameInput">实体基础名</label>
                        <input id="graphBaseNameInput" type="text" value="${escapeAttribute(entity.baseName)}" placeholder="例如 bigmouthedflower">
                        <p class="field-hint">影响导出文件名、geometry 标识符和动作名。</p>
                    </div>
                    <div class="field">
                        <label for="graphIdentifierInput">命名空间标识符</label>
                        <input id="graphIdentifierInput" type="text" value="${escapeAttribute(entity.identifier)}" placeholder="netease:bigmouthedflower">
                        <p class="field-hint">自动模式会跟随实体基础名生成。</p>
                    </div>
                    <div class="field">
                        <label for="graphResourceSubdirInput">资源子目录</label>
                        <input id="graphResourceSubdirInput" type="text" value="${escapeAttribute(entity.resourceSubdir)}" placeholder="${DEFAULT_SUBDIR}">
                        <p class="field-hint">对应贴图、模型、动作输出目录。</p>
                    </div>
                    <div class="field">
                        <label for="graphBoneIsolationEnabledSelect">普通同名骨骼隔离</label>
                        <select id="graphBoneIsolationEnabledSelect">
                            <option value="true" ${isBoneIsolationEnabled(entity) ? "selected" : ""}>开启</option>
                            <option value="false" ${!isBoneIsolationEnabled(entity) ? "selected" : ""}>关闭</option>
                        </select>
                        <p class="field-hint">关闭后允许多个模型共享普通骨骼名；root 仍会避让整体缩放包装层。</p>
                    </div>
                    <div class="field">
                        <label>系统内置控制器</label>
                        <div class="readonly-field">${escapeHtml(SYSTEM_SCALE_CONTROLLER_KEY)} -> ${escapeHtml(SYSTEM_SCALE_CONTROLLER_NAME)}</div>
                        <p class="field-hint">缩放控制器固定存在，不开放连线编辑。</p>
                    </div>
                </div>
            </section>

            <section class="section-card connection-section">
                <div class="detail-actions">
                    <div>
                        <h3>资源连线板</h3>
                        <p class="field-hint">渲染器卡片里同时装配模型和贴图；动作控制器单独装配。可以拖拽资源到槽位，或先点击资源再点击槽位。</p>
                    </div>
                    <div class="file-actions">
                        <button class="button ghost" type="button" data-action="add-texture-resource">新增贴图资源</button>
                        <button class="button ghost" type="button" data-action="add-geometry-resource">新增模型资源</button>
                        <button class="button ghost" type="button" data-action="add-animation-resource">新增动作资源</button>
                    </div>
                </div>
                ${context.mergedAnimationData.conflicts.length ? `
                    <div class="chip-row">
                        ${context.mergedAnimationData.conflicts.map((conflict) => `<span class="chip warn">动作 key ${escapeHtml(conflict.key)} 在 ${escapeHtml(conflict.firstBindingKey)} / ${escapeHtml(conflict.secondBindingKey)} 上冲突</span>`).join("")}
                    </div>
                ` : ""}
                <div id="connectionBoard" class="connection-board">
                    <svg id="connectionBoardLines" class="connection-board-lines" aria-hidden="true"></svg>
                    ${renderGraphRenderAssemblyLane(entity, context.renderControllerBindings, context.geometryResources, context.textureResources, geometryNodes, textureNodes)}
                    ${renderGraphTypeLane({
                        type: "animation",
                        title: "动作装配",
                        sourceHtml: renderGraphResourceGroup("动作片段", "animation", animationNodes, "还没有动作片段。"),
                        targetHtml: renderGraphAnimationTargetLane(entity, context.animationControllerBindings, context.availableAnimations),
                    })}
                </div>
            </section>

            ${renderEntityProfileSectionHtml(context.entityProfile)}
            ${renderTitleProfileSectionHtml(
                context.titleProfile,
                context.titleTextColorState,
                context.titleBackgroundColorState,
                context.titleDepthTestValue
            )}
            ${renderResourceDetailSectionsHtml(entity, context.textureResources, context.geometryResources, context.animationResources)}
            ${renderBoneIsolationWarningSectionHtml(entity)}
            ${renderControllerKeyReferenceSectionHtml(context.renderBindings, context.animationSlotNames)}
            ${renderUnusedAnimationsSectionHtml(context.unusedAnimations)}
        `;
    }

    /**
     * 渲染跨模型同名骨骼提示，导出时会自动隔离这些冲突骨骼。
     */
    function renderBoneIsolationWarningSectionHtml(entity) {
        const warnings = buildGeometryBoneIsolationContext(entity).warnings;
        if (!warnings.length) {
            return "";
        }
        return `
            <section class="section-card">
                <h3>骨骼隔离提示</h3>
                <p class="field-hint">检测到多个模型资源存在同名骨骼。导出时会自动改名并同步改动画，避免技能模型和本体模型互相串动作。</p>
                <div class="chip-row">
                    ${warnings.slice(0, 12).map((warning) => `<span class="chip warn">${escapeHtml(warning)}</span>`).join("")}
                    ${warnings.length > 12 ? `<span class="chip warn">还有 ${escapeHtml(String(warnings.length - 12))} 条未展示</span>` : ""}
                </div>
            </section>
        `;
    }

    /**
     * 渲染一条连线通道；渲染通道允许模型和贴图共用，动作通道仍然单独成组。
     */
    function renderGraphTypeLane(options) {
        return `
            <section class="graph-lane graph-type-${escapeAttribute(options.type)}">
                <div class="graph-lane-head">
                    <span class="graph-node-kind">${escapeHtml(options.title)}</span>
                    <span class="graph-lane-line"></span>
                </div>
                <div class="graph-lane-body">
                    <div class="graph-lane-side graph-lane-source">
                        ${options.sourceHtml}
                    </div>
                    <div class="graph-lane-side graph-lane-target">
                        ${options.targetHtml}
                    </div>
                </div>
            </section>
        `;
    }

    /**
     * 渲染渲染器装配通道，让一张渲染器卡片同时承载模型和贴图。
     */
    function renderGraphRenderAssemblyLane(entity, bindings, geometryResources, textureResources, geometryNodes, textureNodes) {
        return renderGraphTypeLane({
            type: "render",
            title: "渲染器装配",
            sourceHtml: renderGraphRenderResourcePool(geometryNodes, textureNodes),
            targetHtml: renderGraphRenderAssemblyTargetLane(entity, bindings, geometryResources, textureResources),
        });
    }

    /**
     * 渲染模型和贴图资源池；资源保留自己的类型颜色，避免拖错目标。
     */
    function renderGraphRenderResourcePool(geometryNodes, textureNodes) {
        return `
            <div class="graph-render-resource-pool">
                ${renderGraphResourceGroup("模型资源", "geometry", geometryNodes, "还没有模型资源。")}
                ${renderGraphResourceGroup("贴图资源", "texture", textureNodes, "还没有贴图资源。")}
            </div>
        `;
    }

    /**
     * 渲染渲染器列表；新增渲染器按钮固定在目标区域右上方。
     */
    function renderGraphRenderAssemblyTargetLane(entity, bindings, geometryResources, textureResources) {
        return `
            <section class="graph-target-lane graph-render-target-lane">
                <div class="detail-actions">
                    <div>
                        <h4>渲染器</h4>
                        <p class="field-hint">每张卡片代表一个 render_controller，模型和贴图在同卡片内成组装配。</p>
                    </div>
                    <button class="button ghost" type="button" data-action="add-render-controller">新增额外渲染控制器</button>
                </div>
                <div class="file-stack graph-render-card-list">
                    ${bindings.map((binding, index) => renderGraphRenderControllerCard(entity, binding, index, bindings.length, geometryResources, textureResources)).join("")}
                </div>
            </section>
        `;
    }

    /**
     * 渲染动画控制器的配置区；动作槽位会在动作通道里单独出现。
     */
    function renderGraphAnimationControllerSetup(entity, bindings) {
        return `
            <section class="graph-target-group graph-controller-setup">
                <div class="detail-actions">
                    <h3>动画控制器配置</h3>
                    <button class="button ghost" type="button" data-action="add-animation-controller">新增额外动画控制器</button>
                </div>
                <article class="file-card graph-readonly-card">
                    <div class="file-card-header">
                        <div>
                            <p class="file-title">系统内置控制器</p>
                            <p class="file-name">${escapeHtml(SYSTEM_SCALE_CONTROLLER_KEY)} -> ${escapeHtml(SYSTEM_SCALE_CONTROLLER_NAME)}</p>
                        </div>
                        <span class="chip muted">只读</span>
                    </div>
                </article>
                <div class="file-stack">
                    ${bindings.map((binding, index) => renderGraphAnimationControllerSetupCard(binding, index, bindings.length, entity)).join("")}
                </div>
            </section>
        `;
    }

    /**
     * 渲染动画控制器的目标模型资源下拉框；自动模式按动作 key 后缀推断。
     */
    function renderAnimationTargetGeometryField(entity, binding, inputId) {
        const geometryResources = getGeometryResources(entity);
        const currentValue = normalizeAnimationTargetGeometryKey(binding.targetGeometryKey);
        const hasCurrentGeometry = currentValue === AUTO_ANIMATION_TARGET_GEOMETRY
            || geometryResources.some((resource) => resource.resourceKey === currentValue);
        return `
            <div class="field">
                <label for="${escapeAttribute(inputId)}">目标模型资源</label>
                <select id="${escapeAttribute(inputId)}" data-animation-binding-target-geometry="${escapeAttribute(binding.id)}">
                    <option value="${AUTO_ANIMATION_TARGET_GEOMETRY}" ${currentValue === AUTO_ANIMATION_TARGET_GEOMETRY ? "selected" : ""}>自动推断</option>
                    ${!hasCurrentGeometry ? `<option value="${escapeAttribute(currentValue)}" selected>${escapeHtml(currentValue)}（模型资源不存在）</option>` : ""}
                    ${geometryResources.map((resource) => `<option value="${escapeAttribute(resource.resourceKey)}" ${currentValue === resource.resourceKey ? "selected" : ""}>${escapeHtml(resource.resourceKey)}</option>`).join("")}
                </select>
                <p class="field-hint">自动推断会把 <code>skill1A</code> 指向 <code>a</code>；手动选择后，该控制器全部动作按指定模型隔离骨骼。</p>
            </div>
        `;
    }

    /**
     * 渲染单个动画控制器配置卡片，避免控制器选择和动作连线混在一起。
     */
    function renderGraphAnimationControllerSetupCard(binding, index, total, entity) {
        const currentPreset = getAnimationControllerPreset(binding.controller);
        const hasCurrentPreset = CONTROLLER_PRESETS.some((preset) => preset.name === binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        return `
            <article class="file-card graph-controller-card graph-setup-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">动画控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(binding.key || "未命名绑定")} -> ${escapeHtml(controllerDisplayName)}</p>
                        ${currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : ""}
                    </div>
                    ${total > 1 ? `<button class="button danger mini" type="button" data-action="remove-animation-controller" data-animation-binding-id="${escapeAttribute(binding.id)}">移除</button>` : ""}
                </div>
                <div class="form-grid graph-controller-fields">
                    <div class="field">
                        <label for="graphAnimationBindingKey-${escapeAttribute(binding.id)}">绑定 key</label>
                        <input id="graphAnimationBindingKey-${escapeAttribute(binding.id)}" type="text" value="${escapeAttribute(binding.key || "")}" data-animation-binding-key="${escapeAttribute(binding.id)}" placeholder="${DEFAULT_ANIMATION_BINDING_KEY}">
                    </div>
                    <div class="field">
                        <label for="graphAnimationBindingController-${escapeAttribute(binding.id)}">控制器</label>
                        <select id="graphAnimationBindingController-${escapeAttribute(binding.id)}" data-animation-binding-controller="${escapeAttribute(binding.id)}">
                            ${binding.controller && !hasCurrentPreset ? `<option value="${escapeAttribute(binding.controller)}" selected>${escapeHtml(binding.controller)}（未收录）</option>` : ""}
                            ${CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === binding.controller ? "selected" : ""}>${escapeHtml(formatControllerOptionLabel(preset, preset.name))}</option>`).join("")}
                        </select>
                    </div>
                    ${renderAnimationTargetGeometryField(entity, binding, `graphAnimationTargetGeometry-${binding.id}`)}
                </div>
            </article>
        `;
    }

    /**
     * 渲染动作通道右侧的动画槽位。
     */
    function renderGraphAnimationTargetLane(entity, bindings, availableAnimations) {
        return `
            ${renderGraphAnimationControllerSetup(entity, bindings)}
            <section class="graph-target-lane graph-type-animation">
                <div class="graph-group-title">
                    <h4>动作目标槽位</h4>
                    <span class="chip graph-type-chip">${bindings.length}</span>
                </div>
                <div class="file-stack">
                    ${bindings.map((binding, index) => renderGraphAnimationTargetCard(entity, binding, index, availableAnimations)).join("")}
                </div>
            </section>
        `;
    }

    /**
     * 渲染单个动画控制器在动作通道里的目标槽位卡片。
     */
    function renderGraphAnimationTargetCard(entity, binding, index, availableAnimations) {
        const currentPreset = getAnimationControllerPreset(binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        const slotNames = getBindingSlotNames(binding);
        return `
            <article class="file-card graph-controller-card graph-type-animation">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">动画控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(binding.key || "未命名绑定")} -> ${escapeHtml(controllerDisplayName)}</p>
                    </div>
                </div>
                <div class="graph-slot-group">
                    <h4>动作槽位</h4>
                    <div class="graph-slot-list">
                        ${slotNames.length ? slotNames.map((slotName) => renderGraphAnimationSlot(entity, binding, slotName, availableAnimations)).join("") : '<p class="empty-state">当前控制器没有识别到可编辑动作 key。</p>'}
                    </div>
                </div>
            </article>
        `;
    }

    /**
     * 渲染资源池里的一个分组，模型、贴图和动作片段共用。
     */
    function renderGraphResourceGroup(title, type, nodes, emptyText) {
        return `
            <section class="graph-resource-group graph-type-${escapeAttribute(type)}">
                <div class="graph-group-title">
                    <h4>${escapeHtml(title)}</h4>
                    <span class="chip graph-type-chip ${nodes.length ? "" : "muted"}">${nodes.length}</span>
                </div>
                <div class="graph-node-list">
                    ${nodes.length ? nodes.map((node) => renderGraphResourceNode(node)).join("") : `<p class="empty-state">${escapeHtml(emptyText)}</p>`}
                </div>
            </section>
        `;
    }

    /**
     * 渲染一个可拖拽资源节点，节点本身不保存状态，只通过 data 属性参与连线。
     */
    function renderGraphResourceNode(node) {
        return `
            <article
                class="graph-node graph-resource-node graph-type-${escapeAttribute(node.type)}"
                draggable="true"
                data-graph-node-id="${escapeAttribute(node.nodeId)}"
                data-graph-resource-type="${escapeAttribute(node.type)}"
                data-graph-resource-id="${escapeAttribute(node.resourceId)}"
                data-graph-animation-name="${escapeAttribute(node.animationName)}"
            >
                <span class="graph-node-kind">${escapeHtml(typeLabel(node.type))}</span>
                <strong>${escapeHtml(node.title)}</strong>
                <small>${escapeHtml(node.subtitle)}</small>
            </article>
        `;
    }

    /**
     * 渲染连线板中的渲染控制器卡片，保留控制器选择和条件输入。
     */
    function renderGraphRenderControllerCard(entity, binding, index, total, geometryResources, textureResources) {
        const currentPreset = getRenderControllerPreset(binding.controller);
        const hasCurrentPreset = RENDER_CONTROLLER_PRESETS.some((preset) => preset.name === binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        const geometryEntries = getRenderBindingMappingEntries(entity, binding, "geometry", geometryResources);
        const textureEntries = getRenderBindingMappingEntries(entity, binding, "texture", textureResources);
        return `
            <article class="file-card graph-controller-card graph-render-controller-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">渲染控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(controllerDisplayName)}</p>
                        ${currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : ""}
                    </div>
                    ${total > 1 ? `<button class="button danger mini" type="button" data-action="remove-render-controller" data-render-binding-id="${escapeAttribute(binding.id)}">移除</button>` : ""}
                </div>
                <div class="form-grid graph-controller-fields">
                    <div class="field field-wide">
                        <label for="graphRenderBindingController-${escapeAttribute(binding.id)}">控制器</label>
                        <select id="graphRenderBindingController-${escapeAttribute(binding.id)}" data-render-binding-controller="${escapeAttribute(binding.id)}">
                            ${binding.controller && !hasCurrentPreset ? `<option value="${escapeAttribute(binding.controller)}" selected>${escapeHtml(binding.controller)}（未收录）</option>` : ""}
                            ${RENDER_CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === binding.controller ? "selected" : ""}>${escapeHtml(formatControllerOptionLabel(preset, preset.name))}</option>`).join("")}
                        </select>
                    </div>
                    <div class="field field-wide">
                        <label for="graphRenderBindingCondition-${escapeAttribute(binding.id)}">条件</label>
                        <input id="graphRenderBindingCondition-${escapeAttribute(binding.id)}" type="text" value="${escapeAttribute(binding.condition || "")}" data-render-binding-condition="${escapeAttribute(binding.id)}" placeholder="">
                    </div>
                </div>
                <div class="graph-render-slot-pair">
                    ${renderGraphRenderSlotGroup(entity, binding, "geometry", geometryEntries, geometryResources)}
                    ${renderGraphRenderSlotGroup(entity, binding, "texture", textureEntries, textureResources)}
                </div>
            </article>
        `;
    }

    /**
     * 渲染渲染控制器的 Geometry / Texture 槽位集合。
     */
    function renderGraphRenderSlotGroup(entity, binding, type, entries, resources) {
        const title = type === "geometry" ? "Geometry 槽位" : "Texture 槽位";
        return `
            <div class="graph-slot-group">
                <h4>${escapeHtml(title)}</h4>
                <div class="graph-slot-list">
                    ${entries.length ? entries.map((entry) => renderGraphRenderSlot(entity, binding, type, entry, resources)).join("") : `<p class="empty-state">当前控制器没有 ${escapeHtml(type)} key。</p>`}
                </div>
            </div>
        `;
    }

    /**
     * 渲染单个模型或贴图槽位；渲染槽位用拖拽替换资源，不暴露空值。
     */
    function renderGraphRenderSlot(entity, binding, type, entry, resources) {
        const resource = resources.find((item) => item.id === entry.resourceId) || null;
        const nodeId = resource ? getGraphNodeId(type, resource.id) : "";
        const preview = type === "geometry" && resource
            ? buildGeometryResourceIdentifier(entity, resource, 0)
            : type === "texture" && resource
                ? `${buildTextureResourcePath(entity, resource)}.png`
                : "等待资源";
        return `
            <div
                class="graph-slot graph-type-${escapeAttribute(type)}"
                data-graph-slot-type="${escapeAttribute(type)}"
                data-graph-binding-id="${escapeAttribute(binding.id)}"
                data-graph-slot-key="${escapeAttribute(entry.key)}"
                data-graph-current-node-id="${escapeAttribute(nodeId)}"
            >
                <div>
                    <strong>${escapeHtml(type === "geometry" ? `Geometry.${entry.key}` : `Texture.${entry.key}`)}</strong>
                    <p class="field-hint">${resource ? escapeHtml(resource.resourceKey) : "未连接资源"}</p>
                    <small>${escapeHtml(preview)}</small>
                </div>
                <span class="chip">${resource ? "已连接" : "待连接"}</span>
            </div>
        `;
    }

    /**
     * 渲染连线板中的动画控制器卡片，业务控制器可以自由增删。
     */
    function renderGraphAnimationControllerCard(entity, binding, index, total, availableAnimations) {
        const currentPreset = getAnimationControllerPreset(binding.controller);
        const hasCurrentPreset = CONTROLLER_PRESETS.some((preset) => preset.name === binding.controller);
        const controllerDisplayName = formatControllerDisplayName(currentPreset, binding.controller || "未选择控制器");
        const slotNames = getBindingSlotNames(binding);
        return `
            <article class="file-card graph-controller-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">动画控制器 ${index + 1}</p>
                        <p class="file-name">${escapeHtml(binding.key || "未命名绑定")} -> ${escapeHtml(controllerDisplayName)}</p>
                        ${currentPreset ? buildControllerDescriptionHtml(currentPreset.description, currentPreset.source) : ""}
                    </div>
                    ${total > 1 ? `<button class="button danger mini" type="button" data-action="remove-animation-controller" data-animation-binding-id="${escapeAttribute(binding.id)}">移除</button>` : ""}
                </div>
                <div class="form-grid graph-controller-fields">
                    <div class="field">
                        <label for="graphAnimationBindingKey-${escapeAttribute(binding.id)}">绑定 key</label>
                        <input id="graphAnimationBindingKey-${escapeAttribute(binding.id)}" type="text" value="${escapeAttribute(binding.key || "")}" data-animation-binding-key="${escapeAttribute(binding.id)}" placeholder="${DEFAULT_ANIMATION_BINDING_KEY}">
                    </div>
                    <div class="field">
                        <label for="graphAnimationBindingController-${escapeAttribute(binding.id)}">控制器</label>
                        <select id="graphAnimationBindingController-${escapeAttribute(binding.id)}" data-animation-binding-controller="${escapeAttribute(binding.id)}">
                            ${binding.controller && !hasCurrentPreset ? `<option value="${escapeAttribute(binding.controller)}" selected>${escapeHtml(binding.controller)}（未收录）</option>` : ""}
                            ${CONTROLLER_PRESETS.map((preset) => `<option value="${preset.name}" ${preset.name === binding.controller ? "selected" : ""}>${escapeHtml(formatControllerOptionLabel(preset, preset.name))}</option>`).join("")}
                        </select>
                    </div>
                </div>
                <div class="graph-slot-group">
                    <h4>动作槽位</h4>
                    <div class="graph-slot-list">
                        ${slotNames.length ? slotNames.map((slotName) => renderGraphAnimationSlot(entity, binding, slotName, availableAnimations)).join("") : '<p class="empty-state">当前控制器没有识别到可编辑动作 key。</p>'}
                    </div>
                </div>
            </article>
        `;
    }

    /**
     * 渲染单个动作槽位；动作槽位允许断开，因为导出层已经兼容空映射。
     */
    function renderGraphAnimationSlot(entity, binding, slotName, availableAnimations) {
        const animationName = binding.animationMappings[slotName] || "";
        const nodeId = animationName ? getGraphNodeId("animation", animationName) : "";
        return `
            <div
                class="graph-slot graph-type-animation"
                data-graph-slot-type="animation"
                data-graph-binding-id="${escapeAttribute(binding.id)}"
                data-graph-slot-key="${escapeAttribute(slotName)}"
                data-graph-current-node-id="${escapeAttribute(nodeId)}"
            >
                <div>
                    <strong>${escapeHtml(slotName)}</strong>
                    <p class="field-hint">${escapeHtml(getAnimationSlotDescription(binding, slotName) || "拖入一个动作片段。")}</p>
                    <small>${animationName ? `导出为 animation.${escapeHtml(entity.baseName || "实体名")}.${escapeHtml(slotName)}` : `可选动作 ${availableAnimations.length} 个`}</small>
                </div>
                <div class="graph-slot-actions">
                    <span class="chip ${animationName ? "" : "muted"}">${animationName ? escapeHtml(animationName) : "未连接"}</span>
                    ${animationName ? `<button class="button ghost mini" type="button" data-graph-clear-slot data-graph-slot-type="animation" data-graph-binding-id="${escapeAttribute(binding.id)}" data-graph-slot-key="${escapeAttribute(slotName)}">断开</button>` : ""}
                </div>
            </div>
        `;
    }

    /**
     * 给连线节点生成稳定 id，SVG 画线和拖拽连接都复用它。
     */
    function getGraphNodeId(type, value) {
        return `${type}:${value || ""}`;
    }

    /**
     * 找到动作片段来自哪一个原始动作文件，用于资源池展示。
     */
    function findAnimationSourceNameByAnimationName(entity, animationName) {
        const resource = getAnimationResources(entity).find((item) => (item.animationNames || []).includes(animationName));
        return resource ? resource.sourceName : "";
    }

    function bindInspectorEvents(entity) {
        const mergedAnimationFile = getMergedAnimationFile(entity);
        const baseNameInput = document.getElementById("baseNameInput");
        const identifierInput = document.getElementById("identifierInput");
        const resourceSubdirInput = document.getElementById("resourceSubdirInput");
        const boneIsolationEnabledSelect = document.getElementById("boneIsolationEnabledSelect");
        const profileWidthInput = document.getElementById("profileWidthInput");
        const profileHeightInput = document.getElementById("profileHeightInput");
        const profileScaleInput = document.getElementById("profileScaleInput");
        const profileOpacityInput = document.getElementById("profileOpacityInput");
        const profileRedGainInput = document.getElementById("profileRedGainInput");
        const profileGreenGainInput = document.getElementById("profileGreenGainInput");
        const profileBlueGainInput = document.getElementById("profileBlueGainInput");
        const profileBrightnessInput = document.getElementById("profileBrightnessInput");
        const profileIgnoreLightSelect = document.getElementById("profileIgnoreLightSelect");
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

        boneIsolationEnabledSelect.addEventListener("change", (event) => {
            entity.boneIsolationEnabled = event.target.value === "true";
            render();
        });

        bindEntityProfileInput(profileWidthInput, entity, "width", DEFAULT_ENTITY_PROFILE.width);
        bindEntityProfileInput(profileHeightInput, entity, "height", DEFAULT_ENTITY_PROFILE.height);
        bindEntityProfileInput(profileScaleInput, entity, "scale", DEFAULT_ENTITY_PROFILE.scale);
        bindEntityProfileOpacityInput(profileOpacityInput, entity);
        bindEntityProfileInput(profileRedGainInput, entity, "redGain", DEFAULT_ENTITY_PROFILE.redGain);
        bindEntityProfileInput(profileGreenGainInput, entity, "greenGain", DEFAULT_ENTITY_PROFILE.greenGain);
        bindEntityProfileInput(profileBlueGainInput, entity, "blueGain", DEFAULT_ENTITY_PROFILE.blueGain);
        bindEntityProfileInput(profileBrightnessInput, entity, "brightness", DEFAULT_ENTITY_PROFILE.brightness);
        bindEntityProfileBooleanSelect(profileIgnoreLightSelect, entity, "ignoreLight");
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

        elements.inspector.querySelector("[data-action='add-animation-resource']").addEventListener("click", () => {
            state.pendingAssignment = { entityId: entity.id, type: "animation" };
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

        elements.inspector.querySelectorAll("[data-animation-resource-assign]").forEach((button) => {
            button.addEventListener("click", () => {
                state.pendingAssignment = {
                    entityId: entity.id,
                    type: "animation",
                    resourceId: button.dataset.animationResourceAssign,
                };
                elements.assignInput.accept = ".json";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-resource-remove]").forEach((button) => {
            button.addEventListener("click", () => {
                const resourceId = button.dataset.animationResourceRemove;
                entity.files.animations = getAnimationResources(entity).filter((resource) => resource.id !== resourceId);
                refreshAnimationBindings(entity);
                setStatus("已移除动作资源。");
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
            const recommendedController = mergedAnimationFile
                ? recommendController(mergedAnimationFile.animationNames)
                : DEFAULT_CONTROLLER;
            animationBindings.push(createAnimationControllerBinding({
                key: suggestNextAnimationBindingKey(animationBindings),
                controller: recommendedController,
                animationMappings: buildAnimationMappings(mergedAnimationFile, getControllerSlots(recommendedController), {}),
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
                binding.animationMappings = buildAnimationMappings(mergedAnimationFile, getControllerSlots(binding.controller), binding.animationMappings);
                render();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-target-geometry]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingTargetGeometry);
                if (!binding) {
                    return;
                }
                binding.targetGeometryKey = normalizeAnimationTargetGeometryKey(event.target.value);
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
            clone.boneIsolationEnabled = isBoneIsolationEnabled(entity);
            clone.animationControllerBindings = getAnimationControllerBindings(entity).map((binding) => ({
                id: createId(),
                key: binding.key,
                controller: binding.controller,
                targetGeometryKey: binding.targetGeometryKey,
                animationMappings: { ...(binding.animationMappings || {}) },
            }));
            clone.entityProfile = {
                width: entityProfile.width,
                height: entityProfile.height,
                scale: entityProfile.scale,
                opacity: entityProfile.opacity,
                redGain: entityProfile.redGain,
                greenGain: entityProfile.greenGain,
                blueGain: entityProfile.blueGain,
                brightness: entityProfile.brightness,
                ignoreLight: entityProfile.ignoreLight,
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
                animations: getAnimationResources(entity).map((resource) => ({
                    id: createId(),
                    sourceName: resource.sourceName,
                    json: deepClone(resource.json),
                    animationNames: [...resource.animationNames],
                })),
                texture: null,
                geometry: null,
                animation: null,
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

    /**
     * 绑定连线板模式下的所有交互入口。
     */
    function bindConnectionBoardEvents(entity) {
        const mergedAnimationFile = getMergedAnimationFile(entity);
        bindConnectionBoardBaseInfoEvents(entity);
        bindConnectionBoardProfileAndTitleEvents(entity);
        bindEntityActionEvents(entity);
        bindConnectionBoardResourceEvents(entity);
        bindConnectionBoardControllerEvents(entity, mergedAnimationFile);
        bindConnectionBoardLinkEvents(entity);
        bindConnectionBoardLineRedrawEvents();
    }

    /**
     * 绑定连线板顶部的基础实体字段。
     */
    function bindConnectionBoardBaseInfoEvents(entity) {
        const baseNameInput = document.getElementById("graphBaseNameInput");
        const identifierInput = document.getElementById("graphIdentifierInput");
        const resourceSubdirInput = document.getElementById("graphResourceSubdirInput");
        const boneIsolationEnabledSelect = document.getElementById("graphBoneIsolationEnabledSelect");

        if (baseNameInput) {
            baseNameInput.addEventListener("input", (event) => {
                const focusState = captureInspectorFocus();
                entity.baseName = event.target.value;
                if (entity.identifierMode !== "manual") {
                    entity.identifier = entity.baseName ? `netease:${entity.baseName}` : "";
                }
                renderWithConnectionBoardScroll();
                restoreInspectorFocus(focusState);
            });
        }

        if (identifierInput) {
            identifierInput.addEventListener("input", (event) => {
                const focusState = captureInspectorFocus();
                const value = event.target.value;
                entity.identifier = value;
                const expectedAuto = entity.baseName ? `netease:${entity.baseName}` : "";
                entity.identifierMode = value === expectedAuto || value === "" ? "auto" : "manual";
                renderWithConnectionBoardScroll();
                restoreInspectorFocus(focusState);
            });
        }

        if (resourceSubdirInput) {
            resourceSubdirInput.addEventListener("input", (event) => {
                entity.resourceSubdir = event.target.value;
                renderOutputPreview();
                window.requestAnimationFrame(drawConnectionBoardLines);
            });
        }

        if (boneIsolationEnabledSelect) {
            boneIsolationEnabledSelect.addEventListener("change", (event) => {
                entity.boneIsolationEnabled = event.target.value === "true";
                renderWithConnectionBoardScroll();
            });
        }
    }

    /**
     * 绑定连线板下方的 profile 和标题细项，保证迁移后旧表单不再是唯一编辑入口。
     */
    function bindConnectionBoardProfileAndTitleEvents(entity) {
        const profileWidthInput = document.getElementById("profileWidthInput");
        const profileHeightInput = document.getElementById("profileHeightInput");
        const profileScaleInput = document.getElementById("profileScaleInput");
        const profileOpacityInput = document.getElementById("profileOpacityInput");
        const profileRedGainInput = document.getElementById("profileRedGainInput");
        const profileGreenGainInput = document.getElementById("profileGreenGainInput");
        const profileBlueGainInput = document.getElementById("profileBlueGainInput");
        const profileBrightnessInput = document.getElementById("profileBrightnessInput");
        const profileIgnoreLightSelect = document.getElementById("profileIgnoreLightSelect");
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

        bindEntityProfileInput(profileWidthInput, entity, "width", DEFAULT_ENTITY_PROFILE.width, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileHeightInput, entity, "height", DEFAULT_ENTITY_PROFILE.height, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileScaleInput, entity, "scale", DEFAULT_ENTITY_PROFILE.scale, renderWithConnectionBoardScroll);
        bindEntityProfileOpacityInput(profileOpacityInput, entity, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileRedGainInput, entity, "redGain", DEFAULT_ENTITY_PROFILE.redGain, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileGreenGainInput, entity, "greenGain", DEFAULT_ENTITY_PROFILE.greenGain, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileBlueGainInput, entity, "blueGain", DEFAULT_ENTITY_PROFILE.blueGain, renderWithConnectionBoardScroll);
        bindEntityProfileInput(profileBrightnessInput, entity, "brightness", DEFAULT_ENTITY_PROFILE.brightness, renderWithConnectionBoardScroll);
        bindEntityProfileBooleanSelect(profileIgnoreLightSelect, entity, "ignoreLight");
        bindEntityProfileBooleanSelect(profileHealthBarVisibleSelect, entity, "healthBarVisible");
        bindEntityProfileBooleanSelect(profileBossBarVisibleSelect, entity, "bossBarVisible");
        bindEntityProfileIntegerInput(profileCurrentHealthCountInput, entity, "currentHealthCount", DEFAULT_ENTITY_PROFILE.currentHealthCount, 100, renderWithConnectionBoardScroll);
        bindEntityProfileBooleanSelect(profileForceSelect, entity, "force");
        bindTitleProfileInput(titleTextInput, entity, "text", renderWithConnectionBoardScroll);
        bindTitleColorEditor(entity, "textColor", titleTextColorInput, titleTextColorPicker, titleTextColorAlphaInput, renderWithConnectionBoardScroll);
        bindTitleColorEditor(entity, "backgroundColor", titleBackgroundColorInput, titleBackgroundColorPicker, titleBackgroundColorAlphaInput, renderWithConnectionBoardScroll);
        bindTitleProfileInput(titleOffsetInput, entity, "offset", renderWithConnectionBoardScroll);
        bindTitleProfileInput(titleRotationInput, entity, "rotation", renderWithConnectionBoardScroll);
        bindTitleProfileInput(titleScaleInput, entity, "scale", renderWithConnectionBoardScroll);
        bindTitleDepthTestSelect(titleDepthTestSelect, entity, renderWithConnectionBoardScroll);
    }

    /**
     * 绑定连线板里的复制和删除实体按钮。
     */
    function bindEntityActionEvents(entity) {
        elements.inspector.querySelectorAll("[data-action='duplicate-entity']").forEach((button) => {
            button.addEventListener("click", () => {
                duplicateEntityRecord(entity);
            });
        });

        elements.inspector.querySelectorAll("[data-action='delete-entity']").forEach((button) => {
            button.addEventListener("click", () => {
                deleteEntityRecord(entity);
            });
        });
    }

    /**
     * 复制当前实体及其资源、控制器和 profile 配置。
     */
    function duplicateEntityRecord(entity) {
        const clone = createEntity(entity.baseName);
        const entityProfile = getEntityProfile(entity);
        const oldTextureIdToNewId = {};
        const oldGeometryIdToNewId = {};
        clone.identifier = entity.identifier;
        clone.identifierMode = entity.identifierMode;
        clone.resourceSubdir = entity.resourceSubdir;
        clone.detailMode = getEntityDetailMode(entity);
        clone.boneIsolationEnabled = isBoneIsolationEnabled(entity);
        clone.animationControllerBindings = getAnimationControllerBindings(entity).map((binding) => ({
            id: createId(),
            key: binding.key,
            controller: binding.controller,
            targetGeometryKey: binding.targetGeometryKey,
            animationMappings: { ...(binding.animationMappings || {}) },
        }));
        clone.entityProfile = {
            width: entityProfile.width,
            height: entityProfile.height,
            scale: entityProfile.scale,
            opacity: entityProfile.opacity,
            redGain: entityProfile.redGain,
            greenGain: entityProfile.greenGain,
            blueGain: entityProfile.blueGain,
            brightness: entityProfile.brightness,
            ignoreLight: entityProfile.ignoreLight,
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
            animations: getAnimationResources(entity).map((resource) => ({
                id: createId(),
                sourceName: resource.sourceName,
                json: deepClone(resource.json),
                animationNames: [...resource.animationNames],
            })),
            texture: null,
            geometry: null,
            animation: null,
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
    }

    /**
     * 删除当前实体并自动选中下一个可用实体。
     */
    function deleteEntityRecord(entity) {
        state.entities = state.entities.filter((item) => item.id !== entity.id);
        if (state.selectedEntityId === entity.id) {
            state.selectedEntityId = state.entities[0] ? state.entities[0].id : null;
        }
        setStatus(`已删除实体：${entity.baseName || "未命名实体"}`);
        render();
    }

    /**
     * 绑定连线板中的资源新增按钮。
     */
    function bindConnectionBoardResourceEvents(entity) {
        elements.inspector.querySelectorAll("[data-action='add-texture-resource']").forEach((textureButton) => {
            textureButton.addEventListener("click", () => {
                state.pendingAssignment = { entityId: entity.id, type: "texture" };
                elements.assignInput.accept = ".png";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-action='add-geometry-resource']").forEach((geometryButton) => {
            geometryButton.addEventListener("click", () => {
                state.pendingAssignment = { entityId: entity.id, type: "geometry" };
                elements.assignInput.accept = ".json";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-action='add-animation-resource']").forEach((animationButton) => {
            animationButton.addEventListener("click", () => {
                state.pendingAssignment = { entityId: entity.id, type: "animation" };
                elements.assignInput.accept = ".json";
                elements.assignInput.click();
            });
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
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-resource-assign]").forEach((button) => {
            button.addEventListener("click", () => {
                state.pendingAssignment = {
                    entityId: entity.id,
                    type: "animation",
                    resourceId: button.dataset.animationResourceAssign,
                };
                elements.assignInput.accept = ".json";
                elements.assignInput.click();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-resource-remove]").forEach((button) => {
            button.addEventListener("click", () => {
                const resourceId = button.dataset.animationResourceRemove;
                entity.files.animations = getAnimationResources(entity).filter((resource) => resource.id !== resourceId);
                refreshAnimationBindings(entity);
                setStatus("已移除动作资源。");
                renderWithConnectionBoardScroll();
            });
        });
    }

    /**
     * 绑定连线板中的控制器新增、删除和字段修改。
     */
    function bindConnectionBoardControllerEvents(entity, mergedAnimationFile) {
        const renderBindings = getRenderControllers(entity);
        const animationBindings = getAnimationControllerBindings(entity);

        elements.inspector.querySelectorAll("[data-action='add-render-controller']").forEach((addRenderButton) => {
            addRenderButton.addEventListener("click", () => {
                renderBindings.push(createRenderControllerBinding());
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-action='add-animation-controller']").forEach((addAnimationButton) => {
            addAnimationButton.addEventListener("click", () => {
                const recommendedController = mergedAnimationFile
                    ? recommendController(mergedAnimationFile.animationNames)
                    : DEFAULT_CONTROLLER;
                animationBindings.push(createAnimationControllerBinding({
                    key: suggestNextAnimationBindingKey(animationBindings),
                    controller: recommendedController,
                    animationMappings: buildAnimationMappings(mergedAnimationFile, getControllerSlots(recommendedController), {}),
                }));
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-render-binding-controller]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingController);
                if (!binding) {
                    return;
                }
                binding.controller = event.target.value;
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-render-binding-condition]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingCondition);
                if (binding) {
                    binding.condition = event.target.value;
                }
            });

            input.addEventListener("change", (event) => {
                const binding = findRenderControllerBinding(entity, event.target.dataset.renderBindingCondition);
                if (!binding) {
                    return;
                }
                binding.condition = event.target.value;
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-action='remove-render-controller']").forEach((button) => {
            button.addEventListener("click", () => {
                const bindingId = button.dataset.renderBindingId;
                entity.renderControllers = getRenderControllers(entity).filter((binding) => binding.id !== bindingId);
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-key]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingKey);
                if (binding) {
                    binding.key = event.target.value;
                }
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
                    renderWithConnectionBoardScroll();
                    return;
                }
                binding.key = nextKey;
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-controller]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingController);
                if (!binding) {
                    return;
                }
                binding.controller = event.target.value;
                binding.animationMappings = buildAnimationMappings(mergedAnimationFile, getControllerSlots(binding.controller), binding.animationMappings);
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-animation-binding-target-geometry]").forEach((select) => {
            select.addEventListener("change", (event) => {
                const binding = findAnimationControllerBinding(entity, event.target.dataset.animationBindingTargetGeometry);
                if (!binding) {
                    return;
                }
                binding.targetGeometryKey = normalizeAnimationTargetGeometryKey(event.target.value);
                renderWithConnectionBoardScroll();
            });
        });

        elements.inspector.querySelectorAll("[data-action='remove-animation-controller']").forEach((button) => {
            button.addEventListener("click", () => {
                const bindingId = button.dataset.animationBindingId;
                entity.animationControllerBindings = getAnimationControllerBindings(entity).filter((binding) => binding.id !== bindingId);
                renderWithConnectionBoardScroll();
            });
        });
    }

    /**
     * 绑定资源节点到槽位的点击、拖拽和断开行为。
     */
    function bindConnectionBoardLinkEvents(entity) {
        let selectedPayload = null;
        const nodes = elements.inspector.querySelectorAll("[data-graph-resource-type]");
        const slots = elements.inspector.querySelectorAll("[data-graph-slot-type]");

        nodes.forEach((node) => {
            node.addEventListener("click", () => {
                selectedPayload = readGraphResourcePayload(node);
                nodes.forEach((item) => item.classList.remove("is-selected"));
                node.classList.add("is-selected");
                setConnectionBoardActiveType(selectedPayload.type);
            });

            node.addEventListener("dragstart", (event) => {
                selectedPayload = readGraphResourcePayload(node);
                const payloadText = JSON.stringify(selectedPayload);
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData("application/x-better-appearance-graph", payloadText);
                event.dataTransfer.setData("text/plain", payloadText);
                setConnectionBoardActiveType(selectedPayload.type);
                startGraphDragAutoScroll(event);
            });

            node.addEventListener("dragend", () => {
                stopGraphDragAutoScroll();
                clearConnectionBoardTargetState();
            });
        });

        slots.forEach((slot) => {
            slot.addEventListener("click", () => {
                if (!selectedPayload) {
                    return;
                }
                applyGraphConnection(entity, slot, selectedPayload);
            });

            slot.addEventListener("dragover", (event) => {
                const payload = readGraphTransferPayload(event) || selectedPayload;
                if (payload && canConnectGraphResourceToSlot(payload, slot)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                    slot.classList.add("is-drop-ready");
                    slot.classList.remove("is-drop-blocked");
                    return;
                }
                slot.classList.add("is-drop-blocked");
            });

            slot.addEventListener("dragleave", () => {
                slot.classList.remove("is-drop-ready", "is-drop-blocked");
            });

            slot.addEventListener("drop", (event) => {
                event.preventDefault();
                stopGraphDragAutoScroll();
                clearConnectionBoardTargetState();
                const payload = readGraphTransferPayload(event);
                if (payload) {
                    applyGraphConnection(entity, slot, payload);
                }
            });
        });

        elements.inspector.querySelectorAll("[data-graph-clear-slot]").forEach((button) => {
            button.addEventListener("click", (event) => {
                event.stopPropagation();
                clearGraphSlotConnection(entity, button);
            });
        });
    }

    /**
     * 绑定连线板滚动重绘；资源或槽位滚动后，SVG 连线需要重新落点。
     */
    function bindConnectionBoardLineRedrawEvents() {
        const redraw = () => window.requestAnimationFrame(drawConnectionBoardLines);
        elements.inspector.querySelectorAll(".graph-lane-side").forEach((element) => {
            element.addEventListener("scroll", redraw, { passive: true });
        });

        const panel = elements.inspector.closest(".panel");
        if (panel && !panel.dataset.graphLineRedrawBound) {
            panel.addEventListener("scroll", redraw, { passive: true });
            panel.dataset.graphLineRedrawBound = "true";
        }
    }

    /**
     * 连线板内部重渲染时保留滚动位置，避免右侧装配区每次操作都跳回顶部。
     */
    function renderWithConnectionBoardScroll() {
        const scrollState = captureConnectionBoardScrollState();
        render();
        restoreConnectionBoardScrollState(scrollState);
    }

    /**
     * 记录详情面板和每条连线通道左右侧的滚动位置。
     */
    function captureConnectionBoardScrollState() {
        const board = document.getElementById("connectionBoard");
        if (!board) {
            return null;
        }

        const panel = elements.inspector.closest(".panel");
        return {
            panelTop: panel ? panel.scrollTop : 0,
            panelLeft: panel ? panel.scrollLeft : 0,
            laneSides: Array.from(board.querySelectorAll(".graph-lane-side")).map((element) => ({
                key: getConnectionBoardScrollKey(element),
                top: element.scrollTop,
                left: element.scrollLeft,
            })),
        };
    }

    /**
     * 按通道类型和左右侧恢复滚动位置，并在恢复后重画连线。
     */
    function restoreConnectionBoardScrollState(scrollState) {
        if (!scrollState) {
            return;
        }

        window.requestAnimationFrame(() => {
            const panel = elements.inspector.closest(".panel");
            if (panel) {
                panel.scrollTop = scrollState.panelTop;
                panel.scrollLeft = scrollState.panelLeft;
            }

            const sideScrollMap = new Map(scrollState.laneSides.map((item) => [item.key, item]));
            elements.inspector.querySelectorAll(".graph-lane-side").forEach((element) => {
                const item = sideScrollMap.get(getConnectionBoardScrollKey(element));
                if (!item) {
                    return;
                }
                element.scrollTop = item.top;
                element.scrollLeft = item.left;
            });
            drawConnectionBoardLines();
        });
    }

    /**
     * 给连线板滚动容器生成稳定 key，重渲染后用它找回对应容器。
     */
    function getConnectionBoardScrollKey(element) {
        const lane = element.closest(".graph-lane");
        const laneType = lane
            ? Array.from(lane.classList).find((className) => className.startsWith("graph-type-")) || "graph-type-unknown"
            : "graph-type-unknown";
        const sideType = element.classList.contains("graph-lane-target")
            ? "target"
            : element.classList.contains("graph-lane-source")
                ? "source"
                : "side";
        return `${laneType}:${sideType}`;
    }

    /**
     * 开始拖拽时启动自动滚动，解决资源和槽位数量不对等时拖不到目标的问题。
     */
    function startGraphDragAutoScroll(event) {
        stopGraphDragAutoScroll();
        graphDragAutoScrollState = {
            pointerX: event.clientX,
            pointerY: event.clientY,
            frameId: 0,
            onDragOver: (dragEvent) => {
                if (!graphDragAutoScrollState) {
                    return;
                }
                graphDragAutoScrollState.pointerX = dragEvent.clientX;
                graphDragAutoScrollState.pointerY = dragEvent.clientY;
            },
            onDrop: () => {
                stopGraphDragAutoScroll();
            },
        };
        document.addEventListener("dragover", graphDragAutoScrollState.onDragOver);
        document.addEventListener("drop", graphDragAutoScrollState.onDrop);
        graphDragAutoScrollState.frameId = window.requestAnimationFrame(runGraphDragAutoScroll);
    }

    /**
     * 停止拖拽自动滚动，并释放临时监听。
     */
    function stopGraphDragAutoScroll() {
        if (!graphDragAutoScrollState) {
            return;
        }
        document.removeEventListener("dragover", graphDragAutoScrollState.onDragOver);
        document.removeEventListener("drop", graphDragAutoScrollState.onDrop);
        if (graphDragAutoScrollState.frameId) {
            window.cancelAnimationFrame(graphDragAutoScrollState.frameId);
        }
        graphDragAutoScrollState = null;
    }

    /**
     * 根据鼠标距离滚动区域边缘的距离，持续推动最近的可滚动容器。
     */
    function runGraphDragAutoScroll() {
        if (!graphDragAutoScrollState) {
            return;
        }

        const scrollContainers = collectGraphDragScrollContainers();
        let didScroll = false;
        scrollContainers.forEach((container) => {
            const speed = calculateGraphAutoScrollSpeed(container, graphDragAutoScrollState.pointerX, graphDragAutoScrollState.pointerY);
            if (!speed) {
                return;
            }
            container.scrollTop += speed;
            didScroll = true;
        });

        if (didScroll) {
            drawConnectionBoardLines();
        }
        graphDragAutoScrollState.frameId = window.requestAnimationFrame(runGraphDragAutoScroll);
    }

    /**
     * 收集拖拽时允许自动滚动的容器，优先当前通道左右两侧，其次详情面板。
     */
    function collectGraphDragScrollContainers() {
        const board = document.getElementById("connectionBoard");
        const candidates = [
            ...Array.from(elements.inspector.querySelectorAll(".graph-lane-side")),
            elements.inspector.closest(".panel"),
            board ? board.closest(".panel") : null,
        ].filter(Boolean);
        return [...new Set(candidates)].filter((container) => container.scrollHeight > container.clientHeight + 2);
    }

    /**
     * 鼠标靠近滚动容器上下边缘时返回滚动速度，否则返回 0。
     */
    function calculateGraphAutoScrollSpeed(container, pointerX, pointerY) {
        const rect = container.getBoundingClientRect();
        const edgeSize = 92;
        const maxSpeed = 32;
        const insideHorizontal = pointerX >= rect.left - 32 && pointerX <= rect.right + 32;
        const insideVertical = pointerY >= rect.top && pointerY <= rect.bottom;
        if (!insideHorizontal || !insideVertical) {
            return 0;
        }

        if (pointerY < rect.top + edgeSize) {
            const ratio = (rect.top + edgeSize - pointerY) / edgeSize;
            return -Math.ceil(maxSpeed * ratio);
        }
        if (pointerY > rect.bottom - edgeSize) {
            const ratio = (pointerY - (rect.bottom - edgeSize)) / edgeSize;
            return Math.ceil(maxSpeed * ratio);
        }
        return 0;
    }

    /**
     * 根据当前选中或拖拽的资源类型，高亮可连接槽位并弱化不兼容槽位。
     */
    function setConnectionBoardActiveType(type) {
        const board = document.getElementById("connectionBoard");
        if (!board) {
            return;
        }

        board.dataset.activeGraphType = type || "";
        board.querySelectorAll("[data-graph-slot-type]").forEach((slot) => {
            const isActive = Boolean(type);
            const isCompatible = isActive && slot.dataset.graphSlotType === type;
            slot.classList.toggle("is-compatible-target", isCompatible);
            slot.classList.toggle("is-incompatible-target", isActive && !isCompatible);
        });
    }

    /**
     * 清理拖拽过程中的临时投放状态；不改变已经点击选中的资源。
     */
    function clearConnectionBoardTargetState() {
        const board = document.getElementById("connectionBoard");
        if (!board) {
            return;
        }

        board.removeAttribute("data-active-graph-type");
        board.querySelectorAll("[data-graph-slot-type]").forEach((slot) => {
            slot.classList.remove("is-compatible-target", "is-incompatible-target", "is-drop-ready", "is-drop-blocked");
        });
    }

    /**
     * 从资源节点读取可传输的连线信息。
     */
    function readGraphResourcePayload(node) {
        return {
            type: node.dataset.graphResourceType || "",
            resourceId: node.dataset.graphResourceId || "",
            animationName: node.dataset.graphAnimationName || "",
        };
    }

    /**
     * 从拖拽事件读取资源信息，兼容自定义类型和 text/plain。
     */
    function readGraphTransferPayload(event) {
        const raw = event.dataTransfer.getData("application/x-better-appearance-graph")
            || event.dataTransfer.getData("text/plain");
        if (!raw) {
            return null;
        }
        try {
            return JSON.parse(raw);
        } catch (_error) {
            return null;
        }
    }

    /**
     * 判断资源类型和目标槽位是否匹配。
     */
    function canConnectGraphResourceToSlot(payload, slot) {
        return payload && payload.type === slot.dataset.graphSlotType;
    }

    /**
     * 将一次连线写入现有实体映射结构。
     */
    function applyGraphConnection(entity, slot, payload) {
        if (!canConnectGraphResourceToSlot(payload, slot)) {
            addMessage("资源类型和槽位类型不匹配，未建立连线。", "warn");
            renderWithConnectionBoardScroll();
            return;
        }

        const slotType = slot.dataset.graphSlotType;
        const bindingId = slot.dataset.graphBindingId;
        const slotKey = slot.dataset.graphSlotKey;

        if (slotType === "geometry" || slotType === "texture") {
            const binding = findRenderControllerBinding(entity, bindingId);
            const resourceExists = slotType === "geometry"
                ? Boolean(findGeometryResource(entity, payload.resourceId))
                : Boolean(findTextureResource(entity, payload.resourceId));
            if (!binding || !resourceExists) {
                addMessage("目标渲染控制器或资源不存在，未建立连线。", "warn");
                renderWithConnectionBoardScroll();
                return;
            }
            const mappings = slotType === "geometry" ? binding.geometryMappings : binding.textureMappings;
            mappings[slotKey] = payload.resourceId;
            addMessage(`${typeLabel(slotType)}已连接到 ${slotType === "geometry" ? "Geometry" : "Texture"}.${slotKey}。`, "info");
            renderWithConnectionBoardScroll();
            return;
        }

        if (slotType === "animation") {
            const binding = findAnimationControllerBinding(entity, bindingId);
            if (!binding || !payload.animationName) {
                addMessage("目标动画控制器或动作片段不存在，未建立连线。", "warn");
                renderWithConnectionBoardScroll();
                return;
            }
            binding.animationMappings[slotKey] = payload.animationName;
            addMessage(`动作 ${payload.animationName} 已连接到 ${slotKey}。`, "info");
            renderWithConnectionBoardScroll();
        }
    }

    /**
     * 断开动作槽位；渲染槽位保持默认资源，不在这里清空。
     */
    function clearGraphSlotConnection(entity, button) {
        if (button.dataset.graphSlotType !== "animation") {
            addMessage("模型和贴图槽位需要保持有效资源，请拖入其他资源完成重连。", "warn");
            renderWithConnectionBoardScroll();
            return;
        }

        const binding = findAnimationControllerBinding(entity, button.dataset.graphBindingId);
        if (!binding) {
            return;
        }
        delete binding.animationMappings[button.dataset.graphSlotKey];
        addMessage(`已断开动作槽位 ${button.dataset.graphSlotKey}。`, "info");
        renderWithConnectionBoardScroll();
    }

    /**
     * 根据当前 DOM 位置绘制资源节点到槽位的可视连线。
     */
    function drawConnectionBoardLines() {
        const board = document.getElementById("connectionBoard");
        const svg = document.getElementById("connectionBoardLines");
        if (!board || !svg) {
            return;
        }

        const boardRect = board.getBoundingClientRect();
        const nodeMap = new Map();
        board.querySelectorAll("[data-graph-node-id]").forEach((node) => {
            nodeMap.set(node.dataset.graphNodeId, node);
        });

        svg.innerHTML = "";
        svg.setAttribute("viewBox", `0 0 ${boardRect.width} ${boardRect.height}`);
        svg.setAttribute("width", String(boardRect.width));
        svg.setAttribute("height", String(boardRect.height));
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        svg.appendChild(defs);
        const laneClipIds = new Map();

        board.querySelectorAll("[data-graph-current-node-id]").forEach((slot) => {
            const nodeId = slot.dataset.graphCurrentNodeId;
            const source = nodeMap.get(nodeId);
            if (!source) {
                return;
            }
            const lane = slot.closest(".graph-lane");
            if (!lane || source.closest(".graph-lane") !== lane) {
                return;
            }
            const sourcePoint = getGraphConnectionPoint(source, boardRect, "source");
            const slotPoint = getGraphConnectionPoint(slot, boardRect, "target");
            if (!sourcePoint || !slotPoint) {
                return;
            }
            const x1 = sourcePoint.x;
            const y1 = sourcePoint.y;
            const x2 = slotPoint.x;
            const y2 = slotPoint.y;
            const curve = Math.max(42, Math.abs(x2 - x1) * 0.42);
            const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("class", `connection-line graph-type-${slot.dataset.graphSlotType || ""}`);
            path.setAttribute("clip-path", `url(#${getGraphLaneClipId(lane, boardRect, defs, laneClipIds)})`);
            path.setAttribute("d", `M ${x1} ${y1} C ${x1 + curve} ${y1}, ${x2 - curve} ${y2}, ${x2} ${y2}`);
            svg.appendChild(path);
        });
    }

    /**
     * 计算连线端点；端点滚出所属通道可视区域后不再画线。
     */
    function getGraphConnectionPoint(element, boardRect, side) {
        const scrollSide = element.closest(".graph-lane-side");
        if (!scrollSide) {
            return null;
        }

        const elementRect = element.getBoundingClientRect();
        const scrollRect = scrollSide.getBoundingClientRect();
        const centerY = elementRect.top + elementRect.height / 2;
        const isVisibleY = centerY >= scrollRect.top
            && centerY <= scrollRect.bottom
            && elementRect.bottom >= scrollRect.top
            && elementRect.top <= scrollRect.bottom;
        if (!isVisibleY) {
            return null;
        }

        const x = side === "source"
            ? Math.min(elementRect.right, scrollRect.right)
            : Math.max(elementRect.left, scrollRect.left);
        return {
            x: x - boardRect.left,
            y: centerY - boardRect.top,
        };
    }

    /**
     * 给每条类型通道创建 SVG 裁剪区域，防止连线穿出自己的通道。
     */
    function getGraphLaneClipId(lane, boardRect, defs, laneClipIds) {
        if (laneClipIds.has(lane)) {
            return laneClipIds.get(lane);
        }

        const clipId = `graphLaneClip${laneClipIds.size}`;
        const laneRect = lane.getBoundingClientRect();
        const clipPath = document.createElementNS("http://www.w3.org/2000/svg", "clipPath");
        const clipRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        clipPath.setAttribute("id", clipId);
        clipRect.setAttribute("x", String(laneRect.left - boardRect.left));
        clipRect.setAttribute("y", String(laneRect.top - boardRect.top));
        clipRect.setAttribute("width", String(laneRect.width));
        clipRect.setAttribute("height", String(laneRect.height));
        clipPath.appendChild(clipRect);
        defs.appendChild(clipPath);
        laneClipIds.set(lane, clipId);
        return clipId;
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
     * 渲染单个动作资源卡片；动作资源没有 resourceKey，但会显示包含多少动画块。
     */
    function renderAnimationResourceFileCard(resource) {
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">动作资源</p>
                        <p class="file-name">${escapeHtml(resource.sourceName || "未命名资源")}</p>
                        <p class="field-hint">包含 <code>${escapeHtml(String((resource.animationNames || []).length))}</code> 个动画块。</p>
                    </div>
                    <span class="chip">${escapeHtml(String((resource.animationNames || []).length))}</span>
                </div>
                <div class="file-actions">
                    <button class="button ghost" type="button" data-animation-resource-assign="${escapeAttribute(resource.id)}">替换文件</button>
                    <button class="button danger" type="button" data-animation-resource-remove="${escapeAttribute(resource.id)}">移除</button>
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
                    ${renderAnimationTargetGeometryField(entity, binding, `animationTargetGeometry-${binding.id}`)}
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
            boneIsolationEnabled: true,
            renderControllers: [
                createRenderControllerBinding(),
            ],
            animationControllerBindings: [
                createAnimationControllerBinding(),
            ],
            files: {
                textures: [],
                geometries: [],
                animations: [],
                texture: null,
                geometry: null,
                animation: null,
            },
            entityProfile: createDefaultEntityProfile(),
        };
    }

    /**
     * 读取实体的普通同名骨骼隔离开关，旧数据默认开启。
     */
    function isBoneIsolationEnabled(entity) {
        if (!entity || typeof entity !== "object") {
            return true;
        }
        if (typeof entity.boneIsolationEnabled !== "boolean") {
            entity.boneIsolationEnabled = true;
        }
        return entity.boneIsolationEnabled;
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
     * 创建默认的动作资源记录，每条记录对应一个 animation.json 文件。
     */
    function createAnimationResource(options) {
        const normalized = options || {};
        return {
            id: normalized.id || createId(),
            sourceName: typeof normalized.sourceName === "string" ? normalized.sourceName : "",
            json: normalized.json || null,
            animationNames: Array.isArray(normalized.animationNames) ? [...normalized.animationNames] : [],
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
            targetGeometryKey: normalizeAnimationTargetGeometryKey(normalized.targetGeometryKey),
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
     * 把旧版单动作文件结构迁移成动作资源列表，便于同一个实体收口多份 animation.json。
     */
    function getAnimationResources(entity) {
        if (!entity.files || typeof entity.files !== "object") {
            entity.files = {};
        }

        if (!Array.isArray(entity.files.animations)) {
            entity.files.animations = entity.files.animation
                ? [createAnimationResource({
                    sourceName: entity.files.animation.sourceName,
                    json: entity.files.animation.json,
                    animationNames: entity.files.animation.animationNames,
                })]
                : [];
        }

        entity.files.animations = entity.files.animations
            .filter((resource) => resource && typeof resource === "object" && resource.json)
            .map((resource) => createAnimationResource(resource));
        entity.files.animation = null;
        return entity.files.animations;
    }

    /**
     * 根据 id 查找动作资源。
     */
    function findAnimationResource(entity, resourceId) {
        return getAnimationResources(entity).find((resource) => resource.id === resourceId) || null;
    }

    /**
     * 把多个动作资源合并成编辑器内部统一使用的一份动作视图。
     */
    function getMergedAnimationFile(entity) {
        const resources = getAnimationResources(entity);
        if (!resources.length) {
            return null;
        }

        const firstResource = resources[0];
        const mergedJson = firstResource && firstResource.json
            ? deepClone(firstResource.json)
            : { format_version: "1.8.0" };
        mergedJson.animations = {};
        let formatVersion = mergedJson.format_version || "";

        resources.forEach((resource) => {
            if (!resource.json || typeof resource.json !== "object") {
                return;
            }

            if (!formatVersion && resource.json.format_version) {
                formatVersion = resource.json.format_version;
            }

            const animations = resource.json.animations || {};
            Object.keys(animations).forEach((animationName) => {
                mergedJson.animations[animationName] = deepClone(animations[animationName]);
            });
        });

        if (formatVersion) {
            mergedJson.format_version = formatVersion;
        }

        return {
            json: mergedJson,
            animationNames: Object.keys(mergedJson.animations),
        };
    }

    /**
     * 当动作资源发生变化时，统一刷新动画控制器绑定和动作槽位映射。
     */
    function refreshAnimationBindings(entity) {
        const mergedAnimationFile = getMergedAnimationFile(entity);
        const animationBindings = getAnimationControllerBindings(entity);

        if (!mergedAnimationFile) {
            animationBindings.forEach((binding) => {
                binding.animationMappings = {};
            });
            return;
        }

        if (animationBindings.length === 1
            && animationBindings[0].key === DEFAULT_ANIMATION_BINDING_KEY
            && animationBindings[0].controller === DEFAULT_CONTROLLER
            && !hasAnyAnimationMappings(animationBindings[0])) {
            animationBindings[0].controller = recommendController(mergedAnimationFile.animationNames);
        }

        animationBindings.forEach((binding) => {
            binding.animationMappings = buildAnimationMappings(
                mergedAnimationFile,
                getBindingSlotNames(binding),
                binding.animationMappings
            );
        });
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
            ? `geometry.${entity.baseName}_${normalizeGeometryIdentifierSuffix(resource.resourceKey)}`
            : `geometry.${entity.baseName}`;
        if (geometryIndex > 0) {
            return `${baseIdentifier}_${geometryIndex + 1}`;
        }
        return baseIdentifier;
    }

    /**
     * geometry 标识符在 `geometry.` 之后不再保留额外点号，统一压成下划线。
     */
    function normalizeGeometryIdentifierSuffix(value) {
        return String(value || "")
            .trim()
            .replace(/\./g, "_");
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
                const targetGeometryKey = resolveAnimationTargetGeometryKey(entity, binding, slotName, sourceName);

                if (!entryMap.has(slotName)) {
                    entryMap.set(slotName, {
                        key: slotName,
                        sourceName,
                        name: `animation.${entity.baseName}.${slotName}`,
                        bindingKey: binding.key,
                        targetGeometryKey,
                    });
                    return;
                }

                const existing = entryMap.get(slotName);
                if (existing.sourceName !== sourceName || existing.targetGeometryKey !== targetGeometryKey) {
                    conflicts.push({
                        key: slotName,
                        firstBindingKey: existing.bindingKey,
                        firstSourceName: existing.sourceName,
                        firstTargetGeometryKey: existing.targetGeometryKey,
                        secondBindingKey: binding.key,
                        secondSourceName: sourceName,
                        secondTargetGeometryKey: targetGeometryKey,
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
     * 决定某个动作槽位应该按哪个模型资源的骨骼改名表导出。
     */
    function resolveAnimationTargetGeometryKey(entity, binding, slotName, sourceName) {
        const geometryKeys = getGeometryResources(entity).map((resource) => resource.resourceKey);
        if (!geometryKeys.length) {
            return "default";
        }

        const manualTarget = normalizeAnimationTargetGeometryKey(binding && binding.targetGeometryKey);
        if (manualTarget !== AUTO_ANIMATION_TARGET_GEOMETRY && geometryKeys.includes(manualTarget)) {
            return manualTarget;
        }

        const inferredTarget = inferAnimationTargetGeometryKey(slotName, geometryKeys)
            || inferAnimationTargetGeometryKey(sourceName, geometryKeys);
        if (inferredTarget) {
            return inferredTarget;
        }

        return geometryKeys.includes("default") ? "default" : geometryKeys[0];
    }

    /**
     * 从动作 key 或完整动画名推断目标模型，例如 skill1A -> a。
     */
    function inferAnimationTargetGeometryKey(animationName, geometryKeys) {
        const finalName = String(animationName || "")
            .split(".")
            .filter(Boolean)
            .pop() || "";
        const match = finalName.match(/^(idle|walk|skill\d+)([A-Za-z])$/i);
        if (!match) {
            return "";
        }

        const suffixKey = normalizeResourceKey(match[2]);
        return geometryKeys.includes(suffixKey) ? suffixKey : "";
    }

    /**
     * 清洗动画控制器目标模型字段，auto 表示按动作 key 自动推断。
     */
    function normalizeAnimationTargetGeometryKey(value) {
        const normalized = String(value || AUTO_ANIMATION_TARGET_GEOMETRY).trim();
        if (!normalized || normalized === AUTO_ANIMATION_TARGET_GEOMETRY) {
            return AUTO_ANIMATION_TARGET_GEOMETRY;
        }
        return normalizeResourceKey(normalized);
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
    function bindTitleColorEditor(entity, key, textInput, colorInput, alphaInput, rerender = render) {
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
            rerender();
        });

        colorInput.addEventListener("input", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
        });

        colorInput.addEventListener("change", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
            rerender();
        });

        alphaInput.addEventListener("input", () => {
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
        });

        alphaInput.addEventListener("change", (event) => {
            event.target.value = formatColorUnit(parseColorAlpha(event.target.value, 1));
            applyColorEditorValue(entity, key, textInput, colorInput, alphaInput);
            rerender();
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
        const renderProfile = entity.entityProfile.render || {};
        entity.entityProfile.redGain = Number.isFinite(Number.parseFloat(renderProfile.red))
            ? Number.parseFloat(renderProfile.red)
            : entity.entityProfile.redGain;
        entity.entityProfile.greenGain = Number.isFinite(Number.parseFloat(renderProfile.green))
            ? Number.parseFloat(renderProfile.green)
            : entity.entityProfile.greenGain;
        entity.entityProfile.blueGain = Number.isFinite(Number.parseFloat(renderProfile.blue))
            ? Number.parseFloat(renderProfile.blue)
            : entity.entityProfile.blueGain;
        entity.entityProfile.opacity = Number.isFinite(Number.parseFloat(renderProfile.alpha))
            ? Number.parseFloat(renderProfile.alpha)
            : entity.entityProfile.opacity;
        entity.entityProfile.brightness = Number.isFinite(Number.parseFloat(renderProfile.brightness))
            ? Number.parseFloat(renderProfile.brightness)
            : entity.entityProfile.brightness;
        if (typeof renderProfile.ignoreLight === "boolean") {
            entity.entityProfile.ignoreLight = renderProfile.ignoreLight;
        }
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
