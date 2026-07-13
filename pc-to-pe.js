(function () {
    "use strict";

    const MODE_ACTION = "action";
    const MODE_COSTUME = "costume";
    const DEFAULT_ACTION_OUTPUT_PREFIX = "animation.test_mod_player";
    const DEFAULT_COSTUME_OUTPUT_NAME = "test_mod_costume";
    const COSTUME_EXTRA_ROOT_PARENT = "rootmove";
    const FALLBACK_ACTION_PREFIX = "action";
    const pinyin = window.pinyinPro && typeof window.pinyinPro.pinyin === "function"
        ? window.pinyinPro.pinyin
        : null;

    const PE_EMPTY_PLAYER_BONES = [
        { name: "root", pivot: [0, 12, 0] },
        { name: "rootmove", parent: "root", pivot: [0, 18, 0] },
        { name: "rootall", parent: "rootmove", pivot: [0, 18, 0] },
        { name: "rootrevolve", parent: "rootall", pivot: [0, 18, 0] },
        { name: "rootw", parent: "rootrevolve", pivot: [0, 12, 0] },
        { name: "waist", parent: "rootw", pivot: [0, 12, 0] },
        { name: "body", parent: "waist", pivot: [0, 12, 0] },
        { name: "jacketbody", parent: "body", pivot: [0, 18, 0] },
        { name: "upbody", parent: "body", pivot: [0, 18, 0] },
        { name: "jacket", parent: "upbody", pivot: [0, 24, 0] },
        { name: "head", parent: "upbody", pivot: [0, 24, 0] },
        { name: "hat", parent: "head", pivot: [0, 24, 0] },
        { name: "leftArm", parent: "upbody", pivot: [5, 22, 0] },
        { name: "leftSleeve", parent: "leftArm", pivot: [5, 22, 0] },
        { name: "leftForeArm", parent: "leftArm", pivot: [6, 18, 0] },
        { name: "leftForeSleeve", parent: "leftForeArm", pivot: [6, 17.8, 0] },
        { name: "IeftItem", parent: "leftForeArm", pivot: [6, 13.5, 0] },
        { name: "LeftTrail", parent: "IeftItem", pivot: [6, 13, 0] },
        { name: "rightArm", parent: "upbody", pivot: [-5, 22, 0] },
        { name: "rightSleeve", parent: "rightArm", pivot: [-6, 24, 0] },
        { name: "rightForeArm", parent: "rightArm", pivot: [-6, 18, 0] },
        { name: "rightForeSleeve", parent: "rightForeArm", pivot: [-6, 17.7, 0] },
        { name: "rightItem", parent: "rightForeArm", pivot: [-6.5, 13.5, 0] },
        { name: "RightTrail", parent: "rightItem", pivot: [-6.5, 15, 0] },
        { name: "leftLeg", parent: "rootw", pivot: [1.9, 12, 0] },
        { name: "leftPantsLeg", parent: "leftLeg", pivot: [1.9, 12, 0] },
        { name: "leftForeLeg", parent: "leftLeg", pivot: [2, 6, 0] },
        { name: "leftPantsForeLeg", parent: "leftForeLeg", pivot: [1.9, 6, 0] },
        { name: "rightLeg", parent: "rootw", pivot: [-1.9, 12, 0] },
        { name: "RightPantsLeg", parent: "rightLeg", pivot: [-1.9, 12, 0] },
        { name: "rightForeLeg", parent: "rightLeg", pivot: [-2, 6, 0] },
        { name: "RightPantsForeLeg", parent: "rightForeLeg", pivot: [-2, 6, 0] },
    ];
    const PE_PLAYER_BONE_NAMES = PE_EMPTY_PLAYER_BONES.map((bone) => bone.name);
    const BONE_NAME_MAP = {
        Root: "rootw",
        Body: "body",
        Head: "head",
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
        mode: MODE_ACTION,
        action: {
            outputPrefix: DEFAULT_ACTION_OUTPUT_PREFIX,
            files: [],
            actionKeys: {},
            customActionKeyIds: new Set(),
            result: null,
            errors: [],
        },
        costume: {
            outputName: DEFAULT_COSTUME_OUTPUT_NAME,
            customOutputName: false,
            geometryFile: null,
            textureFile: null,
            animationFile: null,
            result: null,
            errors: [],
        },
    };

    const elements = {
        converterRoot: document.getElementById("converterRoot"),
        pcActionInput: document.getElementById("pcActionInput"),
        pcCostumeInput: document.getElementById("pcCostumeInput"),
        statusText: document.getElementById("converterStatusText"),
        typeText: document.getElementById("converterTypeText"),
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
            await loadPcActionOrCostumeFiles(event.target.files);
            event.target.value = "";
            render();
        });

        elements.pcCostumeInput.addEventListener("change", async (event) => {
            await loadPcCostumeFiles(event.target.files);
            event.target.value = "";
            render();
        });
    }

    /**
     * 渲染完整转换器界面。
     */
    function render() {
        elements.converterRoot.innerHTML = `
            <section class="panel converter-panel">
                <div class="panel-head">
                    <div>
                        <p class="panel-kicker">Converter</p>
                        <h2>${escapeHtml(getModeLabel())}</h2>
                    </div>
                    <a class="button ghost" href="./index.html">返回编辑器</a>
                </div>

                <div class="converter-mode-switch" role="tablist" aria-label="转换类型">
                    <button class="button secondary ${state.mode === MODE_ACTION ? "is-active" : ""}" type="button" data-action="switch-action">PC 玩家动作转 PE 玩家动作</button>
                    <button class="button secondary ${state.mode === MODE_COSTUME ? "is-active" : ""}" type="button" data-action="switch-costume">PC 时装转 PE 时装</button>
                </div>

                ${state.mode === MODE_ACTION ? renderActionMode() : renderCostumeMode()}
            </section>
        `;
        bindRenderEvents();
        updateStatusText();
    }

    /**
     * 渲染动作转换模式。
     */
    function renderActionMode() {
        const action = state.action;
        const animationEntries = getActionEntries();
        return `
            <div class="converter-layout">
                <section class="section-card converter-control">
                    <div id="pcActionDropZone" class="drop-zone converter-drop-zone" tabindex="0" role="button" aria-label="导入 PC 动作文件">
                        <p>导入 PC 动作文件</p>
                        <span>支持 .json 和 .animation.json</span>
                    </div>

                    <div class="form-grid">
                        <div class="field">
                            <label for="pcToPeOutputPrefixInput">动作 key 前缀</label>
                            <input id="pcToPeOutputPrefixInput" type="text" value="${escapeAttribute(action.outputPrefix)}" placeholder="例如 animation.test_mod_player">
                            <p class="field-hint">也可以只填 <code>test_mod_player</code>，系统会补成 <code>animation.test_mod_player</code>。</p>
                        </div>

                        <div class="field">
                            <label>转换规则</label>
                            <div class="readonly-field">只改 PE 动画 key 和玩家骨骼名</div>
                            <p class="field-hint">不做动作槽位映射，不猜技能语义，导入的动作块会全部转换。</p>
                        </div>
                    </div>

                    <div class="detail-actions">
                        <button class="button secondary converter-button" type="button" data-action="select-action-files">选择 PC 动作文件</button>
                        <button class="button ghost" type="button" data-action="clear-action-files" ${action.files.length ? "" : "disabled"}>清空文件</button>
                    </div>

                    ${renderActionFileList()}
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
                        <button class="button primary" type="button" data-action="convert-action-download" ${animationEntries.length ? "" : "disabled"}>转换并下载 ZIP</button>
                    </div>
                    <p class="field-hint">将自动转换 ${escapeHtml(String(animationEntries.length))} 个动作块：中文动作名转拼音，匹配 PC/PE 玩家骨骼名，保留关键帧。</p>
                    ${renderActionResult()}
                </section>
            </div>
        `;
    }

    /**
     * 渲染时装转换模式。
     */
    function renderCostumeMode() {
        const costume = state.costume;
        const canConvert = Boolean(costume.geometryFile && costume.textureFile);
        const splitPlan = costume.geometryFile ? createCostumeSplitPlan(costume.geometryFile.json) : null;
        const canSplit = Boolean(canConvert && splitPlan && splitPlan.personBoneNames.size && splitPlan.extraBoneNames.size);
        return `
            <div class="converter-layout">
                <section class="section-card converter-control">
                    <div id="pcCostumeDropZone" class="drop-zone converter-drop-zone" tabindex="0" role="button" aria-label="导入 PC 时装文件">
                        <p>导入 PC 时装文件</p>
                        <span>必须包含 .geo.json 和 .png，可选 .animation.json</span>
                    </div>

                    <div class="form-grid">
                        <div class="field">
                            <label for="pcToPeCostumeNameInput">输出基础名</label>
                            <input id="pcToPeCostumeNameInput" type="text" value="${escapeAttribute(costume.outputName)}" placeholder="例如 sz_xiaoyuan">
                            <p class="field-hint">用于生成 <code>geometry.${escapeHtml(costume.outputName || DEFAULT_COSTUME_OUTPUT_NAME)}</code>、贴图文件名和可选动画 key 前缀。</p>
                        </div>

                        <div class="field">
                            <label>转换规则</label>
                            <div class="readonly-field">只转换格式、骨架挂载和文件命名</div>
                            <p class="field-hint">不缩放贴图，不改 UV，不改模型尺寸，不额外生成假动画。</p>
                        </div>
                    </div>

                    <div class="detail-actions">
                        <button class="button secondary converter-button" type="button" data-action="select-costume-files">选择 PC 时装文件</button>
                        <button class="button ghost" type="button" data-action="clear-costume-files" ${hasCostumeFiles() ? "" : "disabled"}>清空文件</button>
                    </div>

                    ${renderCostumeFileList()}
                    ${renderCostumeSplitPreview(splitPlan)}
                </section>

                <section class="section-card converter-control">
                    <div class="detail-actions">
                        <button class="button primary" type="button" data-action="convert-costume-download" ${canConvert ? "" : "disabled"}>转换并下载 ZIP</button>
                    </div>
                    <p class="field-hint">ZIP 会包含 <code>${escapeHtml(costume.outputName || DEFAULT_COSTUME_OUTPUT_NAME)}.geo.json</code>、<code>${escapeHtml(costume.outputName || DEFAULT_COSTUME_OUTPUT_NAME)}.png</code>，如果导入了动作文件还会包含 animation json。</p>
                    ${renderCostumeResult()}
                </section>

                <section class="section-card converter-control">
                    <div class="detail-actions">
                        <h3>拆分导出</h3>
                        <button class="button primary" type="button" data-action="split-costume-download" ${canSplit ? "" : "disabled"}>导出纯人物 + 纯额外组 ZIP</button>
                    </div>
                    <p class="field-hint">这个按钮不会影响上面的完整导出，会额外生成 <code>person/</code> 和 <code>extra/</code> 两套结果。只有识别到额外顶层组时才可点击。</p>
                </section>
            </div>
        `;
    }

    /**
     * 渲染已经选择的 PC 动作文件列表。
     */
    function renderActionFileList() {
        const action = state.action;
        if (!action.files.length) {
            return '<div class="empty-state converter-empty">还没有选择 PC 动作文件。</div>';
        }

        return `
            <div class="file-stack">
                ${action.files.map((file) => `
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
     * 渲染已经选择的 PC 时装文件列表。
     */
    function renderCostumeFileList() {
        const costume = state.costume;
        return `
            <div class="costume-file-grid">
                ${renderCostumeFileCard("模型 geo", costume.geometryFile, "必须")}
                ${renderCostumeFileCard("贴图 png", costume.textureFile, "必须")}
                ${renderCostumeFileCard("动作 animation", costume.animationFile, "可选")}
            </div>
        `;
    }

    /**
     * 渲染单个时装输入文件卡片。
     */
    function renderCostumeFileCard(label, fileInfo, requirement) {
        return `
            <article class="file-card">
                <div class="file-card-header">
                    <div>
                        <p class="file-title">${escapeHtml(label)}</p>
                        <p class="file-name">${fileInfo ? escapeHtml(fileInfo.sourceName) : "未导入"}</p>
                    </div>
                    <span class="chip ${fileInfo ? "" : "muted"}">${escapeHtml(requirement)}</span>
                </div>
            </article>
        `;
    }

    /**
     * 渲染时装额外组拆分预览。
     */
    function renderCostumeSplitPreview(splitPlan) {
        if (!splitPlan) {
            return '<div class="empty-state converter-empty">导入 geo 后会识别可拆分的额外顶层组。</div>';
        }

        const extraRoots = splitPlan.extraRootNames.length
            ? splitPlan.extraRootNames.map((name) => `<span class="chip">${escapeHtml(name)}</span>`).join("")
            : '<span class="chip muted">无额外顶层组</span>';
        return `
            <div class="converter-result">
                <p class="field-hint">拆分导出会同时生成纯人物组和纯额外组，默认完整导出不受影响。</p>
                <div class="detail-actions">
                    <span class="chip">人物骨骼 ${escapeHtml(String(splitPlan.personBoneNames.size))}</span>
                    <span class="chip">额外骨骼 ${escapeHtml(String(splitPlan.extraBoneNames.size))}</span>
                    ${extraRoots}
                </div>
            </div>
        `;
    }

    /**
     * 渲染每个动作的可编辑输出 key。
     */
    function renderActionKeyList(animationEntries) {
        const action = state.action;
        if (!animationEntries.length) {
            return '<div class="empty-state converter-empty">导入动作文件后会自动生成推荐输出 key。</div>';
        }

        return `
            <div class="converter-action-key-list">
                ${animationEntries.map((entry) => `
                    <div class="slot-card converter-action-key-card">
                        <label for="pcToPeActionKey-${escapeAttribute(entry.id)}">${escapeHtml(entry.label)}</label>
                        <input id="pcToPeActionKey-${escapeAttribute(entry.id)}" type="text" value="${escapeAttribute(action.actionKeys[entry.id] || "")}" data-action-key-id="${escapeAttribute(entry.id)}">
                    </div>
                `).join("")}
            </div>
        `;
    }

    /**
     * 渲染动作转换结果和错误信息。
     */
    function renderActionResult() {
        const action = state.action;
        const errorItems = action.errors.map((error) => `<li class="error">${escapeHtml(error)}</li>`).join("");
        if (action.result) {
            return `
                <div class="converter-result">
                    <p class="field-hint">已生成 <code>${escapeHtml(action.result.fileName)}</code>，包含 ${escapeHtml(String(action.result.animationCount))} 个 PE 动作。</p>
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
     * 渲染时装转换结果和错误信息。
     */
    function renderCostumeResult() {
        const costume = state.costume;
        const errorItems = costume.errors.map((error) => `<li class="error">${escapeHtml(error)}</li>`).join("");
        if (costume.result) {
            const animationText = costume.result.animationFileName
                ? `、<code>${escapeHtml(costume.result.animationFileName)}</code>`
                : "";
            return `
                <div class="converter-result">
                    <p class="field-hint">已生成 <code>${escapeHtml(costume.result.geometryFileName)}</code>、<code>${escapeHtml(costume.result.textureFileName)}</code>${animationText}。</p>
                    <p class="field-hint">输出模型包含 ${escapeHtml(String(costume.result.boneCount))} 个骨骼，贴图原样输出，geo 贴图尺寸为 ${escapeHtml(String(costume.result.textureWidth))}x${escapeHtml(String(costume.result.textureHeight))}。</p>
                    ${errorItems ? `<ul class="message-list">${errorItems}</ul>` : ""}
                </div>
            `;
        }

        if (errorItems) {
            return `<ul class="message-list">${errorItems}</ul>`;
        }

        return '<p class="field-hint">先选择或拖入 PC 时装 geo 和 png，动画文件可不导入。</p>';
    }

    /**
     * 绑定当前渲染出的控件事件。
     */
    function bindRenderEvents() {
        bindActionInputs();
        bindCostumeInputs();
        bindActionDropZone();
        bindCostumeDropZone();

        elements.converterRoot.querySelectorAll("[data-action]").forEach((button) => {
            button.addEventListener("click", async () => {
                await handleAction(button.dataset.action);
            });
        });
    }

    /**
     * 绑定动作转换输入框事件。
     */
    function bindActionInputs() {
        const action = state.action;
        const outputPrefixInput = elements.converterRoot.querySelector("#pcToPeOutputPrefixInput");
        if (outputPrefixInput) {
            outputPrefixInput.addEventListener("input", (event) => {
                action.outputPrefix = event.target.value;
                clearActionResult();
            });

            outputPrefixInput.addEventListener("change", (event) => {
                action.outputPrefix = normalizeOutputPrefix(event.target.value) || event.target.value;
                refreshRecommendedActionKeys();
                clearActionResult();
                render();
            });
        }

        elements.converterRoot.querySelectorAll("[data-action-key-id]").forEach((input) => {
            input.addEventListener("input", (event) => {
                const actionId = event.target.dataset.actionKeyId;
                action.actionKeys[actionId] = event.target.value;
                action.customActionKeyIds.add(actionId);
                clearActionResult();
            });
        });
    }

    /**
     * 绑定时装转换输入框事件。
     */
    function bindCostumeInputs() {
        const costumeNameInput = elements.converterRoot.querySelector("#pcToPeCostumeNameInput");
        if (!costumeNameInput) {
            return;
        }

        costumeNameInput.addEventListener("input", (event) => {
            state.costume.outputName = event.target.value;
            state.costume.customOutputName = true;
            clearCostumeResult();
        });

        costumeNameInput.addEventListener("change", (event) => {
            state.costume.outputName = normalizeAssetName(event.target.value) || event.target.value;
            clearCostumeResult();
            render();
        });
    }

    /**
     * 绑定动作文件拖拽导入区。
     */
    function bindActionDropZone() {
        bindDropZone("pcActionDropZone", () => elements.pcActionInput.click(), async (files) => {
            await loadPcActionOrCostumeFiles(files);
        });
    }

    /**
     * 绑定时装文件拖拽导入区。
     */
    function bindCostumeDropZone() {
        bindDropZone("pcCostumeDropZone", () => elements.pcCostumeInput.click(), async (files) => {
            await loadPcCostumeFiles(files);
        });
    }

    /**
     * 绑定通用拖拽导入区。
     */
    function bindDropZone(dropZoneId, openPicker, loadFiles) {
        const dropZone = elements.converterRoot.querySelector(`#${dropZoneId}`);
        if (!dropZone) {
            return;
        }

        dropZone.addEventListener("click", openPicker);
        dropZone.addEventListener("keydown", (event) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            event.preventDefault();
            openPicker();
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
                    await loadFiles(event.dataTransfer.files);
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
        if (action === "switch-action") {
            state.mode = MODE_ACTION;
            render();
            return;
        }
        if (action === "switch-costume") {
            state.mode = MODE_COSTUME;
            render();
            return;
        }
        if (action === "select-action-files") {
            elements.pcActionInput.click();
            return;
        }
        if (action === "clear-action-files") {
            resetActionFiles();
            render();
            return;
        }
        if (action === "convert-action-download") {
            convertActionResult();
            if (state.action.result) {
                await downloadActionZip();
                return;
            }
            render();
            return;
        }
        if (action === "select-costume-files") {
            elements.pcCostumeInput.click();
            return;
        }
        if (action === "clear-costume-files") {
            resetCostumeFiles();
            render();
            return;
        }
        if (action === "convert-costume-download") {
            await convertCostumeResult();
            if (state.costume.result) {
                await downloadCostumeZip();
                return;
            }
            render();
            return;
        }
        if (action === "split-costume-download") {
            await downloadCostumeSplitZip();
            return;
        }
    }

    /**
     * 读取动作文件；如果用户误选时装文件则自动切到时装模式。
     */
    async function loadPcActionOrCostumeFiles(fileList) {
        const files = Array.from(fileList || []);
        if (isLikelyCostumeFileSelection(files)) {
            state.mode = MODE_COSTUME;
            state.action.errors = [];
            state.action.result = null;
            await loadPcCostumeFiles(files);
            return;
        }

        await loadPcActionFiles(files);
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

        state.action.files = loadedFiles;
        state.action.errors = errors;
        state.action.result = null;
        state.action.actionKeys = {};
        state.action.customActionKeyIds = new Set();
        refreshRecommendedActionKeys();
    }

    /**
     * 读取用户选择的 PC 时装文件。
     */
    async function loadPcCostumeFiles(fileList) {
        const files = Array.from(fileList || []);
        const errors = [];
        let geometryFile = state.costume.geometryFile;
        let textureFile = state.costume.textureFile;
        let animationFile = state.costume.animationFile;

        for (const file of files) {
            try {
                if (isPngFile(file)) {
                    textureFile = { sourceName: file.name, file };
                    continue;
                }

                const jsonFile = await detectCostumeJsonFile(file);
                if (jsonFile.kind === "geometry") {
                    geometryFile = jsonFile;
                    continue;
                }
                if (jsonFile.kind === "animation") {
                    animationFile = jsonFile;
                    continue;
                }
                errors.push(`${file.name} 不是可识别的时装 geo 或 animation JSON。`);
            } catch (error) {
                errors.push(`${file.name} 读取失败：${error.message}`);
            }
        }

        state.costume.geometryFile = geometryFile;
        state.costume.textureFile = textureFile;
        state.costume.animationFile = animationFile;
        state.costume.errors = errors;
        state.costume.result = null;
        refreshRecommendedCostumeName();
    }

    /**
     * 解析单个动作 JSON 文件。
     */
    async function detectAnimationFile(file) {
        const json = await readJsonFile(file);
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
     * 解析单个时装 JSON 文件。
     */
    async function detectCostumeJsonFile(file) {
        const json = await readJsonFile(file);
        if (json && Array.isArray(json["minecraft:geometry"])) {
            return {
                kind: "geometry",
                sourceName: file.name,
                json,
            };
        }
        if (json && json.animations && typeof json.animations === "object") {
            return {
                kind: "animation",
                sourceName: file.name,
                json,
                animationNames: Object.keys(json.animations),
            };
        }
        return {
            kind: "unknown",
            sourceName: file.name,
            json,
        };
    }

    /**
     * 读取并解析 JSON 文件。
     */
    async function readJsonFile(file) {
        const text = await file.text();
        try {
            return JSON.parse(text);
        } catch (_error) {
            throw new Error("JSON 无法解析");
        }
    }

    /**
     * 判断文件是否是 PNG 贴图。
     */
    function isPngFile(file) {
        return file && (file.type === "image/png" || /\.png$/i.test(file.name));
    }

    /**
     * 判断一组文件是否明显是 PC 时装输入。
     */
    function isLikelyCostumeFileSelection(files) {
        return files.some((file) => isPngFile(file) || /\.geo\.json$/i.test(file.name));
    }

    /**
     * 清空动作输入文件和转换结果。
     */
    function resetActionFiles() {
        state.action.files = [];
        state.action.actionKeys = {};
        state.action.customActionKeyIds = new Set();
        state.action.result = null;
        state.action.errors = [];
    }

    /**
     * 清空时装输入文件和转换结果。
     */
    function resetCostumeFiles() {
        state.costume.geometryFile = null;
        state.costume.textureFile = null;
        state.costume.animationFile = null;
        state.costume.result = null;
        state.costume.errors = [];
    }

    /**
     * 清空动作转换结果，保留当前输入文件。
     */
    function clearActionResult() {
        state.action.result = null;
        state.action.errors = [];
        updateStatusText();
    }

    /**
     * 清空时装转换结果，保留当前输入文件。
     */
    function clearCostumeResult() {
        state.costume.result = null;
        state.costume.errors = [];
        updateStatusText();
    }

    /**
     * 判断当前是否已经导入任意时装文件。
     */
    function hasCostumeFiles() {
        return Boolean(state.costume.geometryFile || state.costume.textureFile || state.costume.animationFile);
    }

    /**
     * 把输入文件中的动作块展开成待转换列表。
     */
    function getActionEntries() {
        const entries = [];
        state.action.files.forEach((file, fileIndex) => {
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
        const action = state.action;
        const entries = getActionEntries();
        const outputPrefix = normalizeOutputPrefix(action.outputPrefix) || DEFAULT_ACTION_OUTPUT_PREFIX;
        const usedSuffixes = new Set();
        const usedKeys = new Set();
        const entryIds = new Set(entries.map((entry) => entry.id));

        Object.keys(action.actionKeys).forEach((entryId) => {
            if (!entryIds.has(entryId)) {
                delete action.actionKeys[entryId];
                action.customActionKeyIds.delete(entryId);
                return;
            }
            if (action.customActionKeyIds.has(entryId) && action.actionKeys[entryId]) {
                usedKeys.add(String(action.actionKeys[entryId]).trim().toLowerCase());
            }
        });

        entries.forEach((entry, index) => {
            if (action.customActionKeyIds.has(entry.id)) {
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
            action.actionKeys[entry.id] = actionKey;
        });
    }

    /**
     * 刷新未手动修改过的推荐时装输出名。
     */
    function refreshRecommendedCostumeName() {
        const costume = state.costume;
        if (costume.customOutputName) {
            return;
        }

        const identifier = getFirstGeometryIdentifier(costume.geometryFile ? costume.geometryFile.json : null);
        const identifierName = identifier && !/^geometry\.steve$/i.test(identifier)
            ? identifier.replace(/^geometry\./i, "")
            : "";
        const fileName = costume.geometryFile ? stripKnownExtensions(costume.geometryFile.sourceName) : "";
        costume.outputName = normalizeAssetName(identifierName || fileName) || DEFAULT_COSTUME_OUTPUT_NAME;
    }

    /**
     * 根据当前输入动作生成转换结果。
     */
    function convertActionResult() {
        const action = state.action;
        const outputPrefix = normalizeOutputPrefix(action.outputPrefix);
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
            action.errors = errors;
            action.result = null;
            return;
        }
        action.outputPrefix = outputPrefix;
        refreshRecommendedActionKeys();

        entries.forEach((entry) => {
            if (!entry || !entry.body || typeof entry.body !== "object") {
                errors.push(`${entry ? entry.animationName : "未知动作"} 不是有效动作块。`);
                return;
            }

            const actionKey = normalizeAnimationKey(action.actionKeys[entry.id]);
            if (!actionKey) {
                errors.push(`${entry.animationName} 的输出 key 格式不正确。`);
                return;
            }
            if (usedKeys.has(actionKey)) {
                errors.push(`输出 key 重复：${actionKey}`);
                return;
            }

            usedKeys.add(actionKey);
            animations[actionKey] = convertActionAnimationBody(entry.body);
        });

        if (!Object.keys(animations).length) {
            errors.push("至少需要导入一个有效动作块。");
        }

        action.errors = errors;
        if (errors.length) {
            action.result = null;
            return;
        }

        action.result = {
            fileName: `${deriveOutputFileName(outputPrefix)}.animation.json`,
            animationCount: Object.keys(animations).length,
            json: {
                format_version: "1.8.0",
                animations,
            },
        };
    }

    /**
     * 根据当前输入时装生成转换结果。
     */
    async function convertCostumeResult() {
        const costume = state.costume;
        const outputName = normalizeAssetName(costume.outputName);
        const errors = [];

        if (!outputName) {
            errors.push("输出基础名格式不正确。");
        }
        if (!costume.geometryFile) {
            errors.push("缺少 PC 时装 .geo.json 文件。");
        }
        if (!costume.textureFile) {
            errors.push("缺少 PC 时装 .png 贴图。");
        }
        if (costume.animationFile && !pinyin) {
            errors.push("拼音转换库未加载，无法自动转换中文动画名。");
        }
        if (errors.length) {
            costume.errors = errors;
            costume.result = null;
            return;
        }

        try {
            costume.outputName = outputName;
            const textureSize = await readTextureSize(costume.textureFile.file);
            const geometryResult = convertCostumeGeometry(costume.geometryFile.json, outputName, textureSize);
            const animationResult = costume.animationFile
                ? convertCostumeAnimation(costume.animationFile.json, outputName, geometryResult.renameMap)
                : null;

            costume.errors = [];
            costume.result = {
                geometryFileName: `${outputName}.geo.json`,
                textureFileName: `${outputName}.png`,
                animationFileName: animationResult ? `${outputName}.animation.json` : "",
                geometryJson: geometryResult.json,
                textureBlob: costume.textureFile.file,
                animationJson: animationResult ? animationResult.json : null,
                animationCount: animationResult ? animationResult.animationCount : 0,
                boneCount: geometryResult.boneCount,
                textureWidth: geometryResult.textureWidth,
                textureHeight: geometryResult.textureHeight,
            };
        } catch (error) {
            costume.errors = [error.message || "时装转换失败。"];
            costume.result = null;
        }
    }

    /**
     * 转换 PC 时装 geo 为 PE 时装 geo。
     */
    function convertCostumeGeometry(sourceJson, outputName, textureSize, options) {
        const sourceGeometry = getFirstGeometry(sourceJson);
        if (!sourceGeometry) {
            throw new Error("geo 文件缺少 minecraft:geometry。");
        }

        const allowedSourceBoneNames = options && options.allowedSourceBoneNames ? options.allowedSourceBoneNames : null;
        const sourceBones = filterSourceBones(
            Array.isArray(sourceGeometry.bones) ? sourceGeometry.bones : [],
            allowedSourceBoneNames
        );
        const sourceDescription = sourceGeometry.description || {};
        const textureWidth = normalizeTextureSize(sourceDescription.texture_width, textureSize ? textureSize.width : 0, 64);
        const textureHeight = normalizeTextureSize(sourceDescription.texture_height, textureSize ? textureSize.height : 0, 64);
        const renameResult = renameCostumeBones(sourceBones);
        const convertedGeometry = deepClone(sourceGeometry);
        convertedGeometry.description = {
            ...sourceDescription,
            identifier: `geometry.${outputName}`,
            texture_width: textureWidth,
            texture_height: textureHeight,
            visible_bounds_width: normalizeVisibleBound(sourceDescription.visible_bounds_width, 4),
            visible_bounds_height: normalizeVisibleBound(sourceDescription.visible_bounds_height, 3),
            visible_bounds_offset: Array.isArray(sourceDescription.visible_bounds_offset)
                ? sourceDescription.visible_bounds_offset
                : [0, 1.5, 0],
        };
        convertedGeometry.bones = [
            ...deepClone(PE_EMPTY_PLAYER_BONES),
            ...deepClone(renameResult.bones),
        ];

        return {
            json: {
                format_version: "1.21.20",
                "minecraft:geometry": [convertedGeometry],
            },
            renameMap: renameResult.renameMap,
            boneCount: convertedGeometry.bones.length,
            textureWidth,
            textureHeight,
        };
    }

    /**
     * 按源骨骼名集合过滤骨骼；未传集合时保留全部骨骼。
     */
    function filterSourceBones(sourceBones, allowedSourceBoneNames) {
        if (!allowedSourceBoneNames) {
            return sourceBones;
        }
        return sourceBones.filter((bone) => bone && allowedSourceBoneNames.has(String(bone.name)));
    }

    /**
     * 创建人物组和额外组的拆分计划。
     */
    function createCostumeSplitPlan(sourceJson) {
        const sourceGeometry = getFirstGeometry(sourceJson);
        const sourceBones = sourceGeometry && Array.isArray(sourceGeometry.bones) ? sourceGeometry.bones : [];
        const boneByName = new Map();
        const topAncestorCache = {};
        const personBoneNames = new Set();
        const extraBoneNames = new Set();
        const extraRootNames = [];

        sourceBones.forEach((bone) => {
            if (bone && bone.name) {
                boneByName.set(String(bone.name), bone);
            }
        });

        sourceBones.forEach((bone) => {
            if (!bone || !bone.name) {
                return;
            }

            const boneName = String(bone.name);
            const topAncestorName = getTopAncestorName(boneName, boneByName, topAncestorCache);
            if (isPlayerRootBoneName(topAncestorName)) {
                personBoneNames.add(boneName);
                return;
            }

            extraBoneNames.add(boneName);
            if (!bone.parent && !extraRootNames.includes(boneName)) {
                extraRootNames.push(boneName);
            }
        });

        return {
            personBoneNames,
            extraBoneNames,
            extraRootNames,
        };
    }

    /**
     * 获取骨骼所属树的顶层祖先名。
     */
    function getTopAncestorName(boneName, boneByName, topAncestorCache) {
        if (topAncestorCache[boneName]) {
            return topAncestorCache[boneName];
        }

        const visited = new Set();
        let currentName = boneName;
        while (currentName && !visited.has(currentName)) {
            visited.add(currentName);
            const currentBone = boneByName.get(currentName);
            if (!currentBone || !currentBone.parent || !boneByName.has(String(currentBone.parent))) {
                topAncestorCache[boneName] = currentName;
                return currentName;
            }
            currentName = String(currentBone.parent);
        }

        topAncestorCache[boneName] = boneName;
        return boneName;
    }

    /**
     * 判断源顶层骨骼是否属于玩家主体骨骼。
     */
    function isPlayerRootBoneName(boneName) {
        return Object.prototype.hasOwnProperty.call(BONE_NAME_MAP, boneName)
            || PE_PLAYER_BONE_NAMES.includes(boneName)
            || isRootLikeBoneName(boneName);
    }

    /**
     * 重命名时装骨骼并挂载到 PE 玩家骨架。
     */
    function renameCostumeBones(sourceBones) {
        const reservedNames = new Set(PE_PLAYER_BONE_NAMES);
        const sourceNameCounts = countSourceBoneNames(sourceBones);
        const sourceNameSet = new Set(Object.keys(sourceNameCounts));
        const usedNames = new Set(PE_PLAYER_BONE_NAMES);
        const renameMap = {};

        sourceBones.forEach((bone) => {
            if (!bone || !bone.name) {
                return;
            }
            const sourceName = String(bone.name);
            const mustRename = reservedNames.has(sourceName)
                || hasNameIgnoreCase(reservedNames, sourceName)
                || Object.prototype.hasOwnProperty.call(BONE_NAME_MAP, sourceName)
                || isRootLikeBoneName(sourceName);
            const baseName = isRootLikeBoneName(sourceName) ? "root_inner" : sourceName;
            const targetName = createUniqueBoneName(baseName, usedNames, sourceNameSet, !mustRename && sourceNameCounts[sourceName] === 1);
            renameMap[sourceName] = targetName;
        });

        const bones = sourceBones
            .filter((bone) => bone && bone.name)
            .map((bone) => convertCostumeBone(bone, renameMap));

        return { bones, renameMap };
    }

    /**
     * 转换单个时装骨骼。
     */
    function convertCostumeBone(sourceBone, renameMap) {
        const originalName = String(sourceBone.name);
        const convertedBone = deepClone(sourceBone);
        convertedBone.name = renameMap[originalName] || originalName;

        if (sourceBone.parent && renameMap[sourceBone.parent]) {
            convertedBone.parent = renameMap[sourceBone.parent];
        } else if (!sourceBone.parent && getPlayerBoneTargetName(originalName)) {
            convertedBone.parent = getPlayerBoneTargetName(originalName);
        } else if (!sourceBone.parent) {
            convertedBone.parent = COSTUME_EXTRA_ROOT_PARENT;
        }

        return convertedBone;
    }

    /**
     * 创建不冲突的骨骼名。
     */
    function createUniqueBoneName(baseName, usedNames, sourceNameSet, allowOriginal) {
        if (allowOriginal && !hasNameIgnoreCase(usedNames, baseName) && !isRootLikeBoneName(baseName)) {
            usedNames.add(baseName);
            return baseName;
        }
        if (!allowOriginal
            && !hasNameIgnoreCase(usedNames, baseName)
            && !hasNameIgnoreCase(sourceNameSet, baseName)
            && !isRootLikeBoneName(baseName)) {
            usedNames.add(baseName);
            return baseName;
        }

        let index = 2;
        let candidate = `${baseName}${index}`;
        while (hasNameIgnoreCase(usedNames, candidate) || hasNameIgnoreCase(sourceNameSet, candidate) || isRootLikeBoneName(candidate)) {
            index += 1;
            candidate = `${baseName}${index}`;
        }
        usedNames.add(candidate);
        return candidate;
    }

    /**
     * 统计输入骨骼名，避免重命名撞上后续原骨骼。
     */
    function countSourceBoneNames(sourceBones) {
        const counts = {};
        sourceBones.forEach((bone) => {
            if (!bone || !bone.name) {
                return;
            }
            const boneName = String(bone.name);
            counts[boneName] = (counts[boneName] || 0) + 1;
        });
        return counts;
    }

    /**
     * 规范化模型可视范围。
     */
    function normalizeVisibleBound(value, fallback) {
        return Number(value) > 0 ? Number(value) : fallback;
    }

    /**
     * 规范化贴图尺寸；优先保留 geo 字段，缺失时才使用 png 实际尺寸。
     */
    function normalizeTextureSize(geoValue, pngValue, fallback) {
        if (Number(geoValue) > 0) {
            return Number(geoValue);
        }
        if (Number(pngValue) > 0) {
            return Number(pngValue);
        }
        return fallback;
    }

    /**
     * 读取 PNG 实际尺寸，不修改图片内容。
     */
    async function readTextureSize(file) {
        const bitmap = await createTextureBitmap(file);
        const size = {
            width: Number(bitmap.width) || 0,
            height: Number(bitmap.height) || 0,
        };
        if (typeof bitmap.close === "function") {
            bitmap.close();
        }
        return size;
    }

    /**
     * 创建贴图位图对象。
     */
    async function createTextureBitmap(file) {
        if (typeof createImageBitmap === "function") {
            return createImageBitmap(file);
        }

        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const image = new Image();
            image.onload = () => {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = () => {
                URL.revokeObjectURL(url);
                reject(new Error("贴图图片无法读取。"));
            };
            image.src = url;
        });
    }

    /**
     * 转换时装附带动画。
     */
    function convertCostumeAnimation(sourceJson, outputName, renameMap, allowedSourceBoneNames) {
        if (!sourceJson || !sourceJson.animations || typeof sourceJson.animations !== "object") {
            throw new Error("animation 文件缺少 animations 字段。");
        }

        const animations = {};
        const usedSuffixes = new Set();
        Object.entries(sourceJson.animations).forEach(([animationName, animationBody], index) => {
            const convertedBody = convertCostumeAnimationBody(animationBody, renameMap, allowedSourceBoneNames);
            if (!convertedBody) {
                return;
            }

            const suffix = buildUniqueAnimationName(extractAnimationSuffix(animationName), index, usedSuffixes);
            animations[`animation.${outputName}.${suffix}`] = convertedBody;
        });

        return {
            json: {
                format_version: "1.8.0",
                animations,
            },
            animationCount: Object.keys(animations).length,
        };
    }

    /**
     * 转换单个时装动画块。
     */
    function convertCostumeAnimationBody(animationBody, renameMap, allowedSourceBoneNames) {
        const converted = deepClone(animationBody);
        if (!converted.bones || typeof converted.bones !== "object") {
            if (allowedSourceBoneNames) {
                return null;
            }
            return converted;
        }

        const bones = {};
        Object.entries(converted.bones).forEach(([boneName, boneTrack]) => {
            if (allowedSourceBoneNames && !allowedSourceBoneNames.has(boneName)) {
                return;
            }

            const targetName = renameMap[boneName] || boneName;
            bones[targetName] = mergeBoneTracks(bones[targetName], boneTrack);
        });
        if (allowedSourceBoneNames && !Object.keys(bones).length) {
            return null;
        }
        converted.bones = bones;
        return converted;
    }

    /**
     * 转换单个 PC 玩家动作块。
     */
    function convertActionAnimationBody(animationBody) {
        const converted = deepClone(animationBody);
        converted.bones = ensurePePlayerBones(convertActionBones(animationBody.bones || {}));
        return converted;
    }

    /**
     * 把 PC 玩家骨骼轨道名转换为 PE 玩家骨骼轨道名。
     */
    function convertActionBones(bones) {
        const convertedBones = {};
        Object.entries(bones).forEach(([boneName, boneTrack]) => {
            const targetName = getPlayerBoneTargetName(boneName) || boneName;
            convertedBones[targetName] = mergeBoneTracks(convertedBones[targetName], boneTrack);
        });
        return convertedBones;
    }

    /**
     * PC 玩家根骨骼按大小写不敏感口径统一映射到 PE 的 rootw。
     */
    function getPlayerBoneTargetName(boneName) {
        if (Object.prototype.hasOwnProperty.call(BONE_NAME_MAP, boneName)) {
            return BONE_NAME_MAP[boneName];
        }
        return isRootLikeBoneName(boneName) ? "rootw" : "";
    }

    /**
     * 判断骨骼名是否会和 PE 最外层 root 冲突。
     */
    function isRootLikeBoneName(boneName) {
        return String(boneName || "").trim().toLowerCase() === "root";
    }

    /**
     * 按大小写不敏感口径判断名称是否已占用。
     */
    function hasNameIgnoreCase(names, candidate) {
        const normalized = String(candidate || "").trim().toLowerCase();
        if (!normalized) {
            return false;
        }
        for (const name of names) {
            if (String(name || "").trim().toLowerCase() === normalized) {
                return true;
            }
        }
        return false;
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
     * 下载当前动作转换结果 ZIP。
     */
    async function downloadActionZip() {
        const action = state.action;
        if (!action.result) {
            convertActionResult();
            render();
            if (!action.result) {
                return;
            }
        }

        if (typeof window.JSZip === "undefined") {
            action.errors = ["JSZip 未加载，当前无法下载 ZIP。"];
            render();
            return;
        }

        const zip = new window.JSZip();
        zip.file(action.result.fileName, JSON.stringify(action.result.json, null, "\t"));
        const blob = await zip.generateAsync({ type: "blob" });
        const downloadName = `pc-to-pe-action-${deriveOutputFileName(action.outputPrefix)}-${createTimestamp()}.zip`;
        downloadBlob(blob, downloadName);
        setStatus(`已下载转换结果：${downloadName}`);
        render();
    }

    /**
     * 下载当前时装转换结果 ZIP。
     */
    async function downloadCostumeZip() {
        const costume = state.costume;
        if (!costume.result) {
            await convertCostumeResult();
            render();
            if (!costume.result) {
                return;
            }
        }

        if (typeof window.JSZip === "undefined") {
            costume.errors = ["JSZip 未加载，当前无法下载 ZIP。"];
            render();
            return;
        }

        const zip = new window.JSZip();
        zip.file(costume.result.geometryFileName, JSON.stringify(costume.result.geometryJson, null, "\t"));
        zip.file(costume.result.textureFileName, costume.result.textureBlob);
        if (costume.result.animationJson && costume.result.animationFileName) {
            zip.file(costume.result.animationFileName, JSON.stringify(costume.result.animationJson, null, "\t"));
        }
        const blob = await zip.generateAsync({ type: "blob" });
        const downloadName = `pc-to-pe-costume-${state.costume.outputName}-${createTimestamp()}.zip`;
        downloadBlob(blob, downloadName);
        setStatus(`已下载转换结果：${downloadName}`);
        render();
    }

    /**
     * 下载人物组和额外组拆分结果 ZIP。
     */
    async function downloadCostumeSplitZip() {
        const costume = state.costume;
        const splitResult = await buildCostumeSplitResult();
        if (!splitResult) {
            render();
            return;
        }

        if (typeof window.JSZip === "undefined") {
            costume.errors = ["JSZip 未加载，当前无法下载 ZIP。"];
            render();
            return;
        }

        const zip = new window.JSZip();
        addCostumePartToZip(zip, "person", splitResult.person);
        addCostumePartToZip(zip, "extra", splitResult.extra);
        const blob = await zip.generateAsync({ type: "blob" });
        const downloadName = `pc-to-pe-costume-split-${splitResult.outputName}-${createTimestamp()}.zip`;
        downloadBlob(blob, downloadName);
        setStatus(`已下载拆分结果：${downloadName}`);
        render();
    }

    /**
     * 构建人物组和额外组拆分结果。
     */
    async function buildCostumeSplitResult() {
        const costume = state.costume;
        const outputName = normalizeAssetName(costume.outputName);
        const errors = [];

        if (!outputName) {
            errors.push("输出基础名格式不正确。");
        }
        if (!costume.geometryFile) {
            errors.push("缺少 PC 时装 .geo.json 文件。");
        }
        if (!costume.textureFile) {
            errors.push("缺少 PC 时装 .png 贴图。");
        }
        if (costume.animationFile && !pinyin) {
            errors.push("拼音转换库未加载，无法自动转换中文动画名。");
        }
        if (errors.length) {
            costume.errors = errors;
            return null;
        }

        try {
            const splitPlan = createCostumeSplitPlan(costume.geometryFile.json);
            if (!splitPlan.personBoneNames.size) {
                throw new Error("未识别到可导出的纯人物组。");
            }
            if (!splitPlan.extraBoneNames.size) {
                throw new Error("未识别到可导出的额外顶层组。");
            }

            const textureSize = await readTextureSize(costume.textureFile.file);
            const personBaseName = `${outputName}_person`;
            const extraBaseName = `${outputName}_extra`;
            const personGeometry = convertCostumeGeometry(
                costume.geometryFile.json,
                personBaseName,
                textureSize,
                { allowedSourceBoneNames: splitPlan.personBoneNames }
            );
            const extraGeometry = convertCostumeGeometry(
                costume.geometryFile.json,
                extraBaseName,
                textureSize,
                { allowedSourceBoneNames: splitPlan.extraBoneNames }
            );
            const personAnimation = costume.animationFile
                ? convertCostumeAnimation(costume.animationFile.json, personBaseName, personGeometry.renameMap, splitPlan.personBoneNames)
                : null;
            const extraAnimation = costume.animationFile
                ? convertCostumeAnimation(costume.animationFile.json, extraBaseName, extraGeometry.renameMap, splitPlan.extraBoneNames)
                : null;

            costume.errors = [];
            return {
                outputName,
                person: buildCostumePartResult(personBaseName, personGeometry, personAnimation, costume.textureFile.file),
                extra: buildCostumePartResult(extraBaseName, extraGeometry, extraAnimation, costume.textureFile.file),
            };
        } catch (error) {
            costume.errors = [error.message || "时装拆分导出失败。"];
            return null;
        }
    }

    /**
     * 组装单个拆分部分的输出文件。
     */
    function buildCostumePartResult(baseName, geometryResult, animationResult, textureBlob) {
        return {
            geometryFileName: `${baseName}.geo.json`,
            textureFileName: `${baseName}.png`,
            animationFileName: animationResult && animationResult.animationCount ? `${baseName}.animation.json` : "",
            geometryJson: geometryResult.json,
            textureBlob,
            animationJson: animationResult && animationResult.animationCount ? animationResult.json : null,
        };
    }

    /**
     * 把拆分部分写入 ZIP 子目录。
     */
    function addCostumePartToZip(zip, directoryName, partResult) {
        zip.file(`${directoryName}/${partResult.geometryFileName}`, JSON.stringify(partResult.geometryJson, null, "\t"));
        zip.file(`${directoryName}/${partResult.textureFileName}`, partResult.textureBlob);
        if (partResult.animationJson && partResult.animationFileName) {
            zip.file(`${directoryName}/${partResult.animationFileName}`, JSON.stringify(partResult.animationJson, null, "\t"));
        }
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
        window.setTimeout(() => {
            URL.revokeObjectURL(url);
        }, 1000);
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
     * 规范化资源基础名。
     */
    function normalizeAssetName(value) {
        const englishText = normalizeAnimationNameToEnglish(value);
        if (!englishText) {
            return "";
        }
        if (/^\d/.test(englishText)) {
            return `costume_${englishText}`;
        }
        return englishText;
    }

    /**
     * 根据动作 key 前缀生成输出文件名。
     */
    function deriveOutputFileName(outputPrefix) {
        const parts = outputPrefix.split(".");
        return parts[1] || DEFAULT_ACTION_OUTPUT_PREFIX.split(".")[1];
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

        const pinyinText = pinyin
            ? pinyin(sourceText, {
                toneType: "none",
                type: "array",
                nonZh: "consecutive",
            }).join("_")
            : sourceText;
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
     * 提取完整动画 key 的最后一段。
     */
    function extractAnimationSuffix(animationName) {
        const text = String(animationName || "").trim();
        const parts = text.split(".").filter(Boolean);
        return parts.length ? parts[parts.length - 1] : text;
    }

    /**
     * 获取 geo 的第一个 identifier。
     */
    function getFirstGeometryIdentifier(json) {
        const geometry = getFirstGeometry(json);
        return geometry && geometry.description ? geometry.description.identifier : "";
    }

    /**
     * 获取 geo 的第一个 geometry 对象。
     */
    function getFirstGeometry(json) {
        if (!json || !Array.isArray(json["minecraft:geometry"])) {
            return null;
        }
        return json["minecraft:geometry"][0] || null;
    }

    /**
     * 去掉常见资源文件扩展名。
     */
    function stripKnownExtensions(fileName) {
        return String(fileName || "")
            .replace(/\.geo\.json$/i, "")
            .replace(/\.animation\.json$/i, "")
            .replace(/\.json$/i, "")
            .replace(/\.png$/i, "");
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
     * 获取当前转换模式名称。
     */
    function getModeLabel() {
        return state.mode === MODE_COSTUME ? "PC 时装转 PE 时装" : "PC 玩家动作转 PE 玩家动作";
    }

    /**
     * 更新顶部状态文本。
     */
    function updateStatusText() {
        if (elements.typeText) {
            elements.typeText.textContent = getModeLabel();
        }

        if (state.mode === MODE_COSTUME) {
            updateCostumeStatusText();
            return;
        }
        updateActionStatusText();
    }

    /**
     * 更新动作模式状态文本。
     */
    function updateActionStatusText() {
        const action = state.action;
        if (action.result) {
            setStatus(`已生成 ${action.result.fileName}。`);
            return;
        }
        if (action.errors.length) {
            setStatus("转换器存在需要处理的问题。");
            return;
        }
        if (action.files.length) {
            setStatus(`已载入 ${action.files.length} 个动作文件。`);
            return;
        }
        setStatus("等待选择 PC 动作文件。");
    }

    /**
     * 更新时装模式状态文本。
     */
    function updateCostumeStatusText() {
        const costume = state.costume;
        if (costume.result) {
            setStatus(`已生成 ${costume.result.geometryFileName} 和 ${costume.result.textureFileName}。`);
            return;
        }
        if (costume.errors.length) {
            setStatus("转换器存在需要处理的问题。");
            return;
        }
        if (hasCostumeFiles()) {
            const loaded = [
                costume.geometryFile ? "geo" : "",
                costume.textureFile ? "png" : "",
                costume.animationFile ? "animation" : "",
            ].filter(Boolean).join(" / ");
            setStatus(`已载入 PC 时装文件：${loaded || "待补齐"}。`);
            return;
        }
        setStatus("等待选择 PC 时装 geo 和 png。");
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
