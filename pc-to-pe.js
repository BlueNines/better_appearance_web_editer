(function () {
    "use strict";

    const DEFAULT_OUTPUT_PREFIX = "animation.test_mod_player";
    const FALLBACK_ACTION_PREFIX = "action";
    const pinyin = window.pinyinPro && typeof window.pinyinPro.pinyin === "function"
        ? window.pinyinPro.pinyin
        : null;
    const PE_PLAYER_BONE_NAMES = [
        "root",
        "rootmove",
        "rootall",
        "rootrevolve",
        "rootw",
        "waist",
        "body",
        "jacketbody",
        "upbody",
        "jacket",
        "head",
        "hat",
        "leftArm",
        "leftSleeve",
        "leftForeArm",
        "leftForeSleeve",
        "IeftItem",
        "LeftTrail",
        "rightArm",
        "rightSleeve",
        "rightForeArm",
        "rightForeSleeve",
        "rightItem",
        "RightTrail",
        "leftLeg",
        "leftPantsLeg",
        "leftForeLeg",
        "leftPantsForeLeg",
        "rightLeg",
        "RightPantsLeg",
        "rightForeLeg",
        "RightPantsForeLeg",
    ];
    const BONE_NAME_MAP = {
        Root: "rootw",
        Body: "body",
        head: "head",
        RightArm: "rightArm",
        RightForeArm: "rightForeArm",
        RightItem: "rightItem",
        LeftArm: "leftArm",
        LeftForeArm: "leftForeArm",
        IeftItem: "IeftItem",
        LeftItem: "IeftItem",
        RightLeg: "rightLeg",
        RightForeLeg: "rightForeLeg",
        LeftLeg: "leftLeg",
        LeftForeLeg: "leftForeLeg",
    };

    const state = {
        outputPrefix: DEFAULT_OUTPUT_PREFIX,
        files: [],
        actionKeys: {},
        customActionKeyIds: new Set(),
        result: null,
        errors: [],
    };

    const elements = {
        converterRoot: document.getElementById("converterRoot"),
        pcActionInput: document.getElementById("pcActionInput"),
        statusText: document.getElementById("converterStatusText"),
    };

    init();

    /**
     * 初始化独立转换器页面。
     */
    function init() {
        bindGlobalEvents();
        render();
    }

    /**
     * 绑定页面级文件输入事件。
     */
    function bindGlobalEvents() {
        elements.pcActionInput.addEventListener("change", async (event) => {
            await loadPcActionFiles(event.target.files);
            event.target.value = "";
            render();
        });
    }

    /**
     * 渲染完整转换器界面。
     */
    function render() {
        const animationEntries = getActionEntries();
        elements.converterRoot.innerHTML = `
            <section class="panel converter-panel">
                <div class="panel-head">
                    <div>
                        <p class="panel-kicker">Converter</p>
                        <h2>PC 玩家动作转 PE 玩家动作</h2>
                    </div>
                    <a class="button ghost" href="./index.html">返回编辑器</a>
                </div>

                <div class="converter-layout">
                    <section class="section-card converter-control">
                        <div id="pcActionDropZone" class="drop-zone converter-drop-zone" tabindex="0" role="button" aria-label="导入 PC 动作文件">
                            <p>导入 PC 动作文件</p>
                            <span>支持 .json 和 .animation.json</span>
                        </div>

                        <div class="form-grid">
                            <div class="field">
                                <label for="pcToPeOutputPrefixInput">动作 key 前缀</label>
                                <input id="pcToPeOutputPrefixInput" type="text" value="${escapeAttribute(state.outputPrefix)}" placeholder="例如 animation.test_mod_player">
                                <p class="field-hint">也可以只填 <code>test_mod_player</code>，系统会补成 <code>animation.test_mod_player</code>。</p>
                            </div>

                            <div class="field">
                                <label>转换类型</label>
                                <div class="readonly-field">PC 玩家动作转 PE 玩家动作</div>
                                <p class="field-hint">第一版先只做玩家动作转换，模型和贴图转换后续再接。</p>
                            </div>
                        </div>

                        <div class="detail-actions">
                            <button class="button secondary converter-button" type="button" data-action="select-files">选择 PC 动作文件</button>
                            <button class="button ghost" type="button" data-action="clear-files" ${state.files.length ? "" : "disabled"}>清空文件</button>
                        </div>

                        ${renderFileList()}
                    </section>

                    <section class="section-card converter-control">
                        <div class="detail-actions">
                            <h3>输出动作 Key</h3>
                            <span class="chip">${escapeHtml(String(animationEntries.length))} 个推荐值</span>
                        </div>
                        ${renderActionKeyList(animationEntries)}
                    </section>

                    <section class="section-card converter-control">
                        <div class="detail-actions">
                            <button class="button primary" type="button" data-action="convert-download" ${animationEntries.length ? "" : "disabled"}>转换并下载 ZIP</button>
                        </div>
                        <p class="field-hint">将自动转换 ${escapeHtml(String(animationEntries.length))} 个动作块：中文动作名转拼音，匹配 PC/PE 玩家骨骼名，保留关键帧。</p>
                        ${renderResult()}
                    </section>
                </div>
            </section>
        `;
        bindRenderEvents();
        updateStatusText();
    }

    /**
     * 渲染已经选择的 PC 动作文件列表。
     */
    function renderFileList() {
        if (!state.files.length) {
            return '<div class="empty-state converter-empty">还没有选择 PC 动作文件。</div>';
        }

        return `
            <div class="file-stack">
                ${state.files.map((file) => `
                    <article class="file-card">
                        <div class="file-card-header">
                            <div>
                                <p class="file-title">${escapeHtml(file.sourceName)}</p>
                                <p class="file-name">包含 ${escapeHtml(String(file.animationNames.length))} 个动作块</p>
                            </div>
                            <span class="chip">${escapeHtml(String(file.animationNames.length))}</span>
                        </div>
                    </article>
                `).join("")}
            </div>
        `;
    }

    /**
     * 渲染每个动作的可编辑输出 key。
     */
    function renderActionKeyList(animationEntries) {
        if (!animationEntries.length) {
            return '<div class="empty-state converter-empty">导入动作文件后会自动生成推荐输出 key。</div>';
        }

        return `
            <div class="converter-action-key-list">
                ${animationEntries.map((entry) => `
                    <div class="slot-card converter-action-key-card">
                        <label for="pcToPeActionKey-${escapeAttribute(entry.id)}">${escapeHtml(entry.label)}</label>
                        <input id="pcToPeActionKey-${escapeAttribute(entry.id)}" type="text" value="${escapeAttribute(state.actionKeys[entry.id] || "")}" data-action-key-id="${escapeAttribute(entry.id)}">
                    </div>
                `).join("")}
            </div>
        `;
    }

    /**
     * 渲染转换结果和错误信息。
     */
    function renderResult() {
        const errorItems = state.errors.map((error) => `<li class="error">${escapeHtml(error)}</li>`).join("");
        if (state.result) {
            return `
                <div class="converter-result">
                    <p class="field-hint">已生成 <code>${escapeHtml(state.result.fileName)}</code>，包含 ${escapeHtml(String(state.result.animationCount))} 个 PE 动作。</p>
                    ${errorItems ? `<ul class="message-list">${errorItems}</ul>` : ""}
                </div>
            `;
        }

        if (errorItems) {
            return `<ul class="message-list">${errorItems}</ul>`;
        }

        return '<p class="field-hint">先选择或拖入 PC 动作文件，然后点击转换并下载 ZIP。</p>';
    }

    /**
     * 绑定当前渲染出的控件事件。
     */
    function bindRenderEvents() {
        const outputPrefixInput = elements.converterRoot.querySelector("#pcToPeOutputPrefixInput");
        if (outputPrefixInput) {
            outputPrefixInput.addEventListener("input", (event) => {
                state.outputPrefix = event.target.value;
                clearResult();
            });

            outputPrefixInput.addEventListener("change", (event) => {
                state.outputPrefix = normalizeOutputPrefix(event.target.value) || event.target.value;
                refreshRecommendedActionKeys();
                clearResult();
                render();
            });
        }

        bindDropZone();

        elements.converterRoot.querySelectorAll("[data-action-key-id]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const actionId = event.target.dataset.actionKeyId;
                state.actionKeys[actionId] = event.target.value;
                state.customActionKeyIds.add(actionId);
                clearResult();
            });
        });

        elements.converterRoot.querySelectorAll("[data-action]").forEach((button) => {
            button.addEventListener("click", async () => {
                await handleAction(button.dataset.action);
            });
        });
    }

    /**
     * 绑定动作文件拖拽导入区。
     */
    function bindDropZone() {
        const dropZone = elements.converterRoot.querySelector("#pcActionDropZone");
        if (!dropZone) {
            return;
        }

        dropZone.addEventListener("click", () => {
            elements.pcActionInput.click();
        });

        dropZone.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            elements.pcActionInput.click();
        });

        ["dragenter", "dragover"].forEach((eventName) => {
            dropZone.addEventListener(eventName, (event) => {
                event.preventDefault();
                dropZone.classList.add("is-dragging");
            });
        });

        ["dragleave", "drop"].forEach((eventName) => {
            dropZone.addEventListener(eventName, async (event) => {
                event.preventDefault();
                if (eventName === "drop") {
                    dropZone.classList.remove("is-dragging");
                    await loadPcActionFiles(event.dataTransfer.files);
                    render();
                    return;
                }

                const relatedTarget = event.relatedTarget;
                if (!relatedTarget || !dropZone.contains(relatedTarget)) {
                    dropZone.classList.remove("is-dragging");
                }
            });
        });
    }

    /**
     * 处理转换器按钮动作。
     */
    async function handleAction(action) {
        if (action === "select-files") {
            elements.pcActionInput.click();
            return;
        }
        if (action === "clear-files") {
            resetFiles();
            render();
            return;
        }
        if (action === "convert-download") {
            convertResult();
            if (state.result) {
                await downloadZip();
                return;
            }
            render();
        }
    }

    /**
     * 读取用户选择的 PC 动作 JSON 文件。
     */
    async function loadPcActionFiles(fileList) {
        const files = Array.from(fileList || []);
        const loadedFiles = [];
        const errors = [];

        for (const file of files) {
            try {
                const detected = await detectAnimationFile(file);
                loadedFiles.push(detected);
            } catch (error) {
                errors.push(`${file.name} 读取失败：${error.message}`);
            }
        }

        state.files = loadedFiles;
        state.errors = errors;
        state.result = null;
        state.actionKeys = {};
        state.customActionKeyIds = new Set();
        refreshRecommendedActionKeys();
    }

    /**
     * 解析单个动作 JSON 文件。
     */
    async function detectAnimationFile(file) {
        const text = await file.text();
        let json;
        try {
            json = JSON.parse(text);
        } catch (_error) {
            throw new Error("JSON 无法解析");
        }

        if (!json || !json.animations || typeof json.animations !== "object") {
            throw new Error("缺少 animations 字段");
        }

        const animationNames = Object.keys(json.animations);
        if (!animationNames.length) {
            throw new Error("没有动作块");
        }

        return {
            sourceName: file.name,
            json,
            animationNames,
        };
    }

    /**
     * 清空输入文件和转换结果。
     */
    function resetFiles() {
        state.files = [];
        state.actionKeys = {};
        state.customActionKeyIds = new Set();
        state.result = null;
        state.errors = [];
    }

    /**
     * 清空转换结果，保留当前输入文件。
     */
    function clearResult() {
        state.result = null;
        state.errors = [];
        updateStatusText();
    }

    /**
     * 把输入文件中的动作块展开成待转换列表。
     */
    function getActionEntries() {
        const entries = [];
        state.files.forEach((file, fileIndex) => {
            file.animationNames.forEach((animationName) => {
                entries.push({
                    id: `${fileIndex}:${animationName}`,
                    fileIndex,
                    animationName,
                    label: `${file.sourceName} · ${animationName}`,
                    body: file.json.animations[animationName],
                });
            });
        });
        return entries;
    }

    /**
     * 刷新未手动修改过的推荐输出 key。
     */
    function refreshRecommendedActionKeys() {
        const entries = getActionEntries();
        const outputPrefix = normalizeOutputPrefix(state.outputPrefix) || DEFAULT_OUTPUT_PREFIX;
        const usedSuffixes = new Set();
        const usedKeys = new Set();
        const entryIds = new Set(entries.map((entry) => entry.id));

        Object.keys(state.actionKeys).forEach((entryId) => {
            if (!entryIds.has(entryId)) {
                delete state.actionKeys[entryId];
                state.customActionKeyIds.delete(entryId);
                return;
            }
            if (state.customActionKeyIds.has(entryId) && state.actionKeys[entryId]) {
                usedKeys.add(String(state.actionKeys[entryId]).trim().toLowerCase());
            }
        });

        entries.forEach((entry, index) => {
            if (state.customActionKeyIds.has(entry.id)) {
                return;
            }

            const suffix = buildUniqueAnimationName(entry.animationName, index, usedSuffixes);
            let actionKey = `${outputPrefix}.${suffix}`;
            let duplicateIndex = 2;
            while (usedKeys.has(actionKey)) {
                actionKey = `${outputPrefix}.${suffix}_${duplicateIndex}`;
                duplicateIndex += 1;
            }
            usedKeys.add(actionKey);
            state.actionKeys[entry.id] = actionKey;
        });
    }

    /**
     * 根据当前输入动作生成转换结果。
     */
    function convertResult() {
        const outputPrefix = normalizeOutputPrefix(state.outputPrefix);
        const errors = [];
        const entries = getActionEntries();
        const animations = {};
        const usedKeys = new Set();

        if (!outputPrefix) {
            errors.push("动作 key 前缀格式不正确。");
        }
        if (!pinyin) {
            errors.push("拼音转换库未加载，无法自动转换中文动作名。");
        }
        if (errors.length) {
            state.errors = errors;
            state.result = null;
            return;
        }
        state.outputPrefix = outputPrefix;
        refreshRecommendedActionKeys();

        entries.forEach((entry, index) => {
            if (!entry || !entry.body || typeof entry.body !== "object") {
                errors.push(`${entry ? entry.animationName : "未知动作"} 不是有效动作块。`);
                return;
            }

            const actionKey = normalizeAnimationKey(state.actionKeys[entry.id]);
            if (!actionKey) {
                errors.push(`${entry.animationName} 的输出 key 格式不正确。`);
                return;
            }
            if (usedKeys.has(actionKey)) {
                errors.push(`输出 key 重复：${actionKey}`);
                return;
            }

            usedKeys.add(actionKey);
            animations[actionKey] = convertAnimationBody(entry.body);
        });

        if (!Object.keys(animations).length) {
            errors.push("至少需要导入一个有效动作块。");
        }

        state.errors = errors;
        if (errors.length) {
            state.result = null;
            return;
        }

        state.result = {
            fileName: `${deriveOutputFileName(outputPrefix)}.animation.json`,
            animationCount: Object.keys(animations).length,
            json: {
                format_version: "1.8.0",
                animations,
            },
        };
    }

    /**
     * 规范化动作 key 前缀，允许用户只填基础名。
     */
    function normalizeOutputPrefix(value) {
        const text = String(value || "").trim();
        if (!/^[a-z0-9_]+$/i.test(text)) {
            const fullPrefix = sanitizeKeyText(text);
            if (/^animation(?:\.[a-z0-9_]+)+$/i.test(fullPrefix)) {
                return fullPrefix;
            }
            return "";
        }
        return `animation.${text}`;
    }

    /**
     * 规范化完整动作 key。
     */
    function normalizeAnimationKey(value) {
        const text = sanitizeKeyText(value);
        if (!/^animation(?:\.[a-z0-9_]+){2,}$/i.test(text)) {
            return "";
        }
        return text;
    }

    /**
     * 清洗 key 文本中的非法字符。
     */
    function sanitizeKeyText(value) {
        return String(value || "")
            .trim()
            .replace(/[^a-zA-Z0-9_.]+/g, "_")
            .replace(/_+/g, "_")
            .replace(/\.+/g, ".")
            .replace(/^\.|\.$/g, "")
            .toLowerCase();
    }

    /**
     * 根据动作 key 前缀生成输出文件名。
     */
    function deriveOutputFileName(outputPrefix) {
        const parts = outputPrefix.split(".");
        return parts[1] || DEFAULT_OUTPUT_PREFIX.split(".")[1];
    }

    /**
     * 为单个输入动作生成不重复的英文动作名。
     */
    function buildUniqueAnimationName(animationName, index, usedNames) {
        const baseName = normalizeAnimationNameToEnglish(animationName) || `${FALLBACK_ACTION_PREFIX}_${index + 1}`;
        let uniqueName = baseName;
        let suffix = 2;
        while (usedNames.has(uniqueName)) {
            uniqueName = `${baseName}_${suffix}`;
            suffix += 1;
        }
        usedNames.add(uniqueName);
        return uniqueName;
    }

    /**
     * 把 PC 动作名清洗成 PE 动画 key 可用的英文片段。
     */
    function normalizeAnimationNameToEnglish(value) {
        const sourceText = String(value || "").trim();
        if (!sourceText) {
            return "";
        }

        const pinyinText = pinyin(sourceText, {
            toneType: "none",
            type: "array",
            nonZh: "consecutive",
        }).join("_");
        const safeText = pinyinText
            .replace(/[^a-zA-Z0-9_]+/g, "_")
            .replace(/_+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase();

        if (!safeText || !/^[a-z0-9_]+$/i.test(safeText)) {
            return "";
        }
        if (/^\d/.test(safeText)) {
            return `${FALLBACK_ACTION_PREFIX}_${safeText}`;
        }
        return safeText;
    }

    /**
     * 转换单个 PC 动作块。
     */
    function convertAnimationBody(animationBody) {
        const converted = deepClone(animationBody);
        converted.bones = ensurePePlayerBones(convertBones(animationBody.bones || {}));
        return converted;
    }

    /**
     * 把 PC 玩家骨骼轨道名转换为 PE 玩家骨骼轨道名。
     */
    function convertBones(bones) {
        const convertedBones = {};
        Object.entries(bones).forEach(([boneName, boneTrack]) => {
            const targetName = BONE_NAME_MAP[boneName] || boneName;
            convertedBones[targetName] = mergeBoneTracks(convertedBones[targetName], boneTrack);
        });
        return convertedBones;
    }

    /**
     * 合并映射到同一 PE 骨骼的轨道。
     */
    function mergeBoneTracks(existingTrack, nextTrack) {
        if (!existingTrack) {
            return deepClone(nextTrack);
        }
        return {
            ...existingTrack,
            ...deepClone(nextTrack),
        };
    }

    /**
     * 补齐 PE 玩家骨骼空轨道并稳定输出顺序。
     */
    function ensurePePlayerBones(convertedBones) {
        const orderedBones = {};
        PE_PLAYER_BONE_NAMES.forEach((boneName) => {
            orderedBones[boneName] = convertedBones[boneName] || {};
        });

        Object.entries(convertedBones).forEach(([boneName, boneTrack]) => {
            if (Object.prototype.hasOwnProperty.call(orderedBones, boneName)) {
                return;
            }
            orderedBones[boneName] = boneTrack;
        });

        return orderedBones;
    }

    /**
     * 下载当前转换结果 ZIP。
     */
    async function downloadZip() {
        if (!state.result) {
            convertResult();
            render();
            if (!state.result) {
                return;
            }
        }

        if (typeof window.JSZip === "undefined") {
            state.errors = ["JSZip 未加载，当前无法下载 ZIP。"];
            render();
            return;
        }

        const zip = new window.JSZip();
        zip.file(state.result.fileName, JSON.stringify(state.result.json, null, "\t"));
        const blob = await zip.generateAsync({ type: "blob" });
        const downloadName = `pc-to-pe-action-${deriveOutputFileName(state.outputPrefix)}-${createTimestamp()}.zip`;
        downloadBlob(blob, downloadName);
        setStatus(`已下载转换结果：${downloadName}`);
        render();
    }

    /**
     * 下载指定 Blob 文件。
     */
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

    /**
     * 生成下载文件名时间戳。
     */
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

    /**
     * 更新顶部状态文本。
     */
    function updateStatusText() {
        if (state.result) {
            setStatus(`已生成 ${state.result.fileName}。`);
            return;
        }
        if (state.errors.length) {
            setStatus("转换器存在需要处理的问题。");
            return;
        }
        if (state.files.length) {
            setStatus(`已载入 ${state.files.length} 个动作文件。`);
            return;
        }
        setStatus("等待选择 PC 动作文件。");
    }

    /**
     * 设置顶部状态文本。
     */
    function setStatus(text) {
        elements.statusText.textContent = text;
    }

    /**
     * 深拷贝普通 JSON 数据。
     */
    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * 转义 HTML 文本。
     */
    function escapeHtml(value) {
        return String(value)
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    /**
     * 转义 HTML 属性值。
     */
    function escapeAttribute(value) {
        return escapeHtml(value);
    }
})();
