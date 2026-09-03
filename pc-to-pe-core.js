(function (global) {
    "use strict";

    const DEFAULT_ACTION_OUTPUT_PREFIX = "animation.test_mod_player";
    const DEFAULT_COSTUME_OUTPUT_NAME = "test_mod_costume";
    const COSTUME_EXTRA_ROOT_PARENT = "rootmove";
    const FALLBACK_ACTION_PREFIX = "action";
    const COSTUME_ARMOR_PARTS = [
        { key: "head", suffix: "head" },
        { key: "chest", suffix: "chest" },
        { key: "leggings", suffix: "leggings" },
        { key: "boots", suffix: "boots" },
    ];
    const COSTUME_ARMOR_PART_BY_BONE = {
        head: "head",
        hat: "head",
        body: "chest",
        jacketbody: "chest",
        upbody: "chest",
        jacket: "chest",
        leftarm: "chest",
        leftsleeve: "chest",
        leftforearm: "chest",
        leftforesleeve: "chest",
        leftitem: "chest",
        leftitem: "chest",
        lefttrail: "chest",
        rightarm: "chest",
        rightsleeve: "chest",
        rightforearm: "chest",
        rightforesleeve: "chest",
        rightitem: "chest",
        righttrail: "chest",
        waist: "leggings",
        leftleg: "leggings",
        leftpantsleg: "leggings",
        rightleg: "leggings",
        rightpantsleg: "leggings",
        leftforeleg: "boots",
        leftpantsforeleg: "boots",
        rightforeleg: "boots",
        rightpantsforeleg: "boots",
    };

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
        { name: "LeftItem", parent: "leftForeArm", pivot: [6, 13.5, 0] },
        { name: "LeftTrail", parent: "LeftItem", pivot: [6, 13, 0] },
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
    const PE_PLAYER_BONE_NAMES = PE_EMPTY_PLAYER_BONES.map(function (bone) {
        return bone.name;
    });
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
        LeftItem: "LeftItem",
        LeftItem: "LeftItem",
        RightLeg: "rightLeg",
        RightForeLeg: "rightForeLeg",
        LeftLeg: "leftLeg",
        LeftForeLeg: "leftForeLeg",
    };

    /**
     * 转换 PC 时装为完整 PE 时装 ZIP。
     */
    async function convertCostume(params) {
        const input = params || {};
        const outputName = normalizeAssetName(input.outputName || DEFAULT_COSTUME_OUTPUT_NAME);
        if (!outputName) {
            throw new Error("outputName 格式不正确。");
        }
        if (!input.geometryJson) {
            throw new Error("缺少 geometryJson。");
        }
        if (!input.texturePng) {
            throw new Error("缺少 texturePng。");
        }

        const textureSize = await readPngSize(input.texturePng);
        const geometryResult = convertCostumeGeometry(input.geometryJson, outputName, textureSize);
        const animationResult = input.animationJson
            ? convertCostumeAnimation(input.animationJson, outputName, geometryResult.renameMap, null, input)
            : null;
        const files = buildFullCostumeFiles(outputName, geometryResult, animationResult, input.texturePng);
        const zipBlob = await buildZipBlob(files, input);

        return {
            zipBlob,
            files,
            report: {
                outputName,
                boneCount: geometryResult.boneCount,
                animationCount: animationResult ? animationResult.animationCount : 0,
                textureWidth: geometryResult.textureWidth,
                textureHeight: geometryResult.textureHeight,
                warnings: [],
            },
        };
    }

    /**
     * 拆分 PC 时装为纯人物组和纯额外组 ZIP。
     */
    async function splitCostume(params) {
        const input = params || {};
        const outputName = normalizeAssetName(input.outputName || DEFAULT_COSTUME_OUTPUT_NAME);
        if (!outputName) {
            throw new Error("outputName 格式不正确。");
        }
        if (!input.geometryJson) {
            throw new Error("缺少 geometryJson。");
        }
        if (!input.texturePng) {
            throw new Error("缺少 texturePng。");
        }

        const splitPlan = createCostumeSplitPlan(input.geometryJson);
        if (!splitPlan.personBoneNames.size) {
            throw new Error("未识别到可导出的纯人物组。");
        }
        if (!splitPlan.extraBoneNames.size) {
            throw new Error("未识别到可导出的额外顶层组。");
        }

        const textureSize = await readPngSize(input.texturePng);
        const personBaseName = `${outputName}_person`;
        const extraBaseName = `${outputName}_extra`;
        const personGeometry = convertCostumeGeometry(
            input.geometryJson,
            personBaseName,
            textureSize,
            { allowedSourceBoneNames: splitPlan.personBoneNames }
        );
        const extraGeometry = convertCostumeGeometry(
            input.geometryJson,
            extraBaseName,
            textureSize,
            { allowedSourceBoneNames: splitPlan.extraBoneNames }
        );
        const personAnimation = input.animationJson
            ? convertCostumeAnimation(input.animationJson, personBaseName, personGeometry.renameMap, splitPlan.personBoneNames, input)
            : null;
        const extraAnimation = input.animationJson
            ? convertCostumeAnimation(input.animationJson, extraBaseName, extraGeometry.renameMap, splitPlan.extraBoneNames, input)
            : null;
        const files = [
            ...buildCostumePartFiles("person", personBaseName, personGeometry, personAnimation, input.texturePng),
            ...buildCostumePartFiles("extra", extraBaseName, extraGeometry, extraAnimation, input.texturePng),
        ];
        const zipBlob = await buildZipBlob(files, input);

        return {
            zipBlob,
            files,
            report: {
                outputName,
                personBoneCount: splitPlan.personBoneNames.size,
                extraBoneCount: splitPlan.extraBoneNames.size,
                extraRootNames: splitPlan.extraRootNames.slice(),
                warnings: [],
            },
        };
    }

    /**
     * 按头、胸甲、裤腿和鞋子四个部位拆分 PC 时装。
     */
    async function splitCostumeArmor(params) {
        const input = params || {};
        const outputName = normalizeAssetName(input.outputName || DEFAULT_COSTUME_OUTPUT_NAME);
        if (!outputName) {
            throw new Error("outputName 格式不正确。");
        }
        if (!input.geometryJson) {
            throw new Error("缺少 geometryJson。");
        }
        if (!input.texturePng) {
            throw new Error("缺少 texturePng。");
        }

        const splitPlan = createCostumeArmorSplitPlan(input.geometryJson);
        const assignedBoneCount = COSTUME_ARMOR_PARTS.reduce(function (count, part) {
            return count + splitPlan.parts[part.key].contentBoneNames.size;
        }, 0);
        if (!assignedBoneCount) {
            throw new Error("未识别到可按头、胸甲、裤腿或鞋子拆分的骨骼。");
        }

        const textureSize = await readPngSize(input.texturePng);
        const files = [];
        const parts = {};
        COSTUME_ARMOR_PARTS.forEach(function (part) {
            const partPlan = splitPlan.parts[part.key];
            const baseName = `${outputName}_${part.suffix}`;
            const geometry = convertCostumeGeometry(
                input.geometryJson,
                baseName,
                textureSize,
                {
                    allowedSourceBoneNames: partPlan.boneNames,
                    contentSourceBoneNames: partPlan.contentBoneNames,
                }
            );
            const animation = input.animationJson
                ? convertCostumeAnimation(input.animationJson, baseName, geometry.renameMap, partPlan.boneNames, input)
                : null;
            const partFiles = buildCostumePartFiles(part.key, baseName, geometry, animation, input.texturePng);
            files.push(...partFiles);
            parts[part.key] = {
                baseName,
                boneCount: geometry.boneCount,
                contentBoneCount: partPlan.contentBoneNames.size,
                animationCount: animation ? animation.animationCount : 0,
            };
        });

        const zipBlob = await buildZipBlob(files, input);
        return {
            zipBlob,
            files,
            parts,
            report: {
                outputName,
                unassignedBoneNames: Array.from(splitPlan.unassignedBoneNames),
                warnings: splitPlan.unassignedVisualBoneNames.size
                    ? [`${splitPlan.unassignedVisualBoneNames.size} 个带模型内容的骨骼无法判定身体部位，未进入四件套。`]
                    : [],
            },
        };
    }

    /**
     * 转换 PC 玩家动作为 PE 玩家动作 ZIP。
     */
    async function convertPlayerActions(params) {
        const input = params || {};
        const animationFiles = Array.isArray(input.animationFiles) ? input.animationFiles : [];
        const outputPrefix = normalizeOutputPrefix(input.outputPrefix || DEFAULT_ACTION_OUTPUT_PREFIX);
        if (!outputPrefix) {
            throw new Error("outputPrefix 格式不正确。");
        }
        if (!animationFiles.length) {
            throw new Error("缺少 animationFiles。");
        }

        const entries = getActionEntries(animationFiles);
        const actionKeys = buildActionKeys(entries, outputPrefix, input.actionKeys || input.actionKeyOverrides || {}, input);
        const animations = {};
        const usedKeys = new Set();
        entries.forEach(function (entry) {
            const actionKey = normalizeAnimationKey(actionKeys[entry.id]);
            if (!actionKey) {
                throw new Error(`${entry.animationName} 的输出 key 格式不正确。`);
            }
            if (usedKeys.has(actionKey)) {
                throw new Error(`输出 key 重复：${actionKey}`);
            }
            usedKeys.add(actionKey);
            animations[actionKey] = convertActionAnimationBody(entry.body);
        });

        const fileName = `${deriveOutputFileName(outputPrefix)}.animation.json`;
        const files = [{
            path: fileName,
            type: "json",
            content: {
                format_version: "1.8.0",
                animations,
            },
        }];
        const zipBlob = await buildZipBlob(files, input);

        return {
            zipBlob,
            files,
            report: {
                outputPrefix,
                actionKeys,
                animationCount: Object.keys(animations).length,
                warnings: [],
            },
        };
    }

    /**
     * 生成完整时装输出文件列表。
     */
    function buildFullCostumeFiles(outputName, geometryResult, animationResult, texturePng) {
        const files = [
            {
                path: `${outputName}.geo.json`,
                type: "json",
                content: geometryResult.json,
            },
            {
                path: `${outputName}.png`,
                type: "binary",
                content: texturePng,
            },
        ];
        if (animationResult && animationResult.animationCount) {
            files.push({
                path: `${outputName}.animation.json`,
                type: "json",
                content: animationResult.json,
            });
        }
        return files;
    }

    /**
     * 生成单个拆分部分的输出文件列表。
     */
    function buildCostumePartFiles(directoryName, baseName, geometryResult, animationResult, texturePng) {
        const files = [
            {
                path: `${directoryName}/${baseName}.geo.json`,
                type: "json",
                content: geometryResult.json,
            },
            {
                path: `${directoryName}/${baseName}.png`,
                type: "binary",
                content: texturePng,
            },
        ];
        if (animationResult && animationResult.animationCount) {
            files.push({
                path: `${directoryName}/${baseName}.animation.json`,
                type: "json",
                content: animationResult.json,
            });
        }
        return files;
    }

    /**
     * 把文件列表打包为 ZIP Blob。
     */
    async function buildZipBlob(files, options) {
        const JSZipCtor = options && options.JSZip ? options.JSZip : global.JSZip;
        if (typeof JSZipCtor === "undefined") {
            throw new Error("JSZip 未加载。");
        }

        const zip = new JSZipCtor();
        files.forEach(function (file) {
            const content = file.type === "json"
                ? JSON.stringify(file.content, null, "\t")
                : file.content;
            zip.file(file.path, content);
        });
        return zip.generateAsync({ type: "blob" });
    }

    /**
     * 从 PC 时装 geo 生成 PE 时装 geo。
     */
    function convertCostumeGeometry(sourceJson, outputName, textureSize, options) {
        const sourceGeometry = getFirstGeometry(sourceJson);
        if (!sourceGeometry) {
            throw new Error("geo 文件缺少 minecraft:geometry。");
        }

        const allowedSourceBoneNames = options && options.allowedSourceBoneNames ? options.allowedSourceBoneNames : null;
        const contentSourceBoneNames = options && options.contentSourceBoneNames ? options.contentSourceBoneNames : null;
        const sourceBones = filterSourceBones(
            Array.isArray(sourceGeometry.bones) ? sourceGeometry.bones : [],
            allowedSourceBoneNames
        );
        const sourceDescription = sourceGeometry.description || {};
        const textureWidth = normalizeTextureSize(sourceDescription.texture_width, textureSize ? textureSize.width : 0, 64);
        const textureHeight = normalizeTextureSize(sourceDescription.texture_height, textureSize ? textureSize.height : 0, 64);
        const renameResult = renameCostumeBones(sourceBones, contentSourceBoneNames);
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
        return sourceBones.filter(function (bone) {
            return bone && allowedSourceBoneNames.has(String(bone.name));
        });
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

        sourceBones.forEach(function (bone) {
            if (bone && bone.name) {
                boneByName.set(String(bone.name), bone);
            }
        });

        sourceBones.forEach(function (bone) {
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
     * 创建头、胸甲、裤腿和鞋子的骨骼拆分计划。
     */
    function createCostumeArmorSplitPlan(sourceJson) {
        const sourceGeometry = getFirstGeometry(sourceJson);
        const sourceBones = sourceGeometry && Array.isArray(sourceGeometry.bones) ? sourceGeometry.bones : [];
        const boneByName = new Map();
        const parts = {};
        const unassignedBoneNames = new Set();
        const unassignedVisualBoneNames = new Set();

        COSTUME_ARMOR_PARTS.forEach(function (part) {
            parts[part.key] = {
                boneNames: new Set(),
                contentBoneNames: new Set(),
            };
        });
        sourceBones.forEach(function (bone) {
            if (bone && bone.name) {
                boneByName.set(String(bone.name), bone);
            }
        });

        sourceBones.forEach(function (bone) {
            if (!bone || !bone.name) {
                return;
            }
            const boneName = String(bone.name);
            const partKey = findCostumeArmorPart(boneName, boneByName);
            if (!partKey) {
                unassignedBoneNames.add(boneName);
                if (hasBoneVisualContent(bone)) {
                    unassignedVisualBoneNames.add(boneName);
                }
                return;
            }
            parts[partKey].contentBoneNames.add(boneName);
        });

        COSTUME_ARMOR_PARTS.forEach(function (part) {
            const partPlan = parts[part.key];
            partPlan.contentBoneNames.forEach(function (boneName) {
                addBoneAndAncestors(boneName, boneByName, partPlan.boneNames);
            });
        });

        return {
            parts,
            unassignedBoneNames,
            unassignedVisualBoneNames,
        };
    }

    /**
     * 从当前骨骼向父级查找最近的四件套归属部位。
     */
    function findCostumeArmorPart(boneName, boneByName) {
        const visited = new Set();
        let currentName = boneName;
        while (currentName && !visited.has(currentName)) {
            visited.add(currentName);
            const partKey = COSTUME_ARMOR_PART_BY_BONE[String(currentName).trim().toLowerCase()];
            if (partKey) {
                return partKey;
            }
            const currentBone = boneByName.get(currentName);
            currentName = currentBone && currentBone.parent ? String(currentBone.parent) : "";
        }
        return "";
    }

    /**
     * 把目标骨骼及其有效父级加入结构骨骼集合。
     */
    function addBoneAndAncestors(boneName, boneByName, targetNames) {
        const visited = new Set();
        let currentName = boneName;
        while (currentName && !visited.has(currentName) && boneByName.has(currentName)) {
            visited.add(currentName);
            targetNames.add(currentName);
            const currentBone = boneByName.get(currentName);
            currentName = currentBone && currentBone.parent ? String(currentBone.parent) : "";
        }
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
    function renameCostumeBones(sourceBones, contentSourceBoneNames) {
        const reservedNames = new Set(PE_PLAYER_BONE_NAMES);
        const sourceNameCounts = countSourceBoneNames(sourceBones);
        const sourceNameSet = new Set(Object.keys(sourceNameCounts));
        const usedNames = new Set(PE_PLAYER_BONE_NAMES);
        const renameMap = {};

        sourceBones.forEach(function (bone) {
            if (!bone || !bone.name) {
                return;
            }
            const sourceName = String(bone.name);
            const mustRename = reservedNames.has(sourceName)
                || hasNameIgnoreCase(reservedNames, sourceName)
                || Object.prototype.hasOwnProperty.call(BONE_NAME_MAP, sourceName)
                || isRootLikeBoneName(sourceName);
            const baseName = isRootLikeBoneName(sourceName) ? "root_inner" : sourceName;
            renameMap[sourceName] = createUniqueBoneName(baseName, usedNames, sourceNameSet, !mustRename && sourceNameCounts[sourceName] === 1);
        });

        const bones = sourceBones
            .filter(function (bone) {
                return bone && bone.name;
            })
            .map(function (bone) {
                const keepsContent = !contentSourceBoneNames || contentSourceBoneNames.has(String(bone.name));
                return convertCostumeBone(bone, renameMap, keepsContent);
            });

        return { bones, renameMap };
    }

    /**
     * 转换单个时装骨骼。
     */
    function convertCostumeBone(sourceBone, renameMap, keepsContent) {
        const originalName = String(sourceBone.name);
        const convertedBone = deepClone(sourceBone);
        convertedBone.name = renameMap[originalName] || originalName;

        if (keepsContent === false) {
            removeBoneVisualContent(convertedBone);
        }

        if (sourceBone.parent && renameMap[sourceBone.parent]) {
            convertedBone.parent = renameMap[sourceBone.parent];
        } else if (getPlayerBoneTargetName(originalName)) {
            convertedBone.parent = getPlayerBoneTargetName(originalName);
        } else if (!sourceBone.parent || !renameMap[sourceBone.parent]) {
            convertedBone.parent = COSTUME_EXTRA_ROOT_PARENT;
        }

        return convertedBone;
    }

    /**
     * 清除仅用于维持父级链的骨骼上的模型和挂点内容。
     */
    function removeBoneVisualContent(bone) {
        delete bone.cubes;
        delete bone.locators;
        delete bone.poly_mesh;
        delete bone.texture_meshes;
    }

    /**
     * 判断骨骼是否携带会出现在模型中的方块、网格或挂点内容。
     */
    function hasBoneVisualContent(bone) {
        return Boolean(
            (Array.isArray(bone.cubes) && bone.cubes.length)
            || (bone.locators && Object.keys(bone.locators).length)
            || bone.poly_mesh
            || (Array.isArray(bone.texture_meshes) && bone.texture_meshes.length)
        );
    }

    /**
     * 转换时装附带动画。
     */
    function convertCostumeAnimation(sourceJson, outputName, renameMap, allowedSourceBoneNames, options) {
        if (!sourceJson || !sourceJson.animations || typeof sourceJson.animations !== "object") {
            throw new Error("animation 文件缺少 animations 字段。");
        }

        const animations = {};
        const usedSuffixes = new Set();
        Object.entries(sourceJson.animations).forEach(function (entry, index) {
            const animationName = entry[0];
            const animationBody = entry[1];
            const convertedBody = convertCostumeAnimationBody(animationBody, renameMap, allowedSourceBoneNames);
            if (!convertedBody) {
                return;
            }

            const suffix = buildUniqueAnimationName(extractAnimationSuffix(animationName), index, usedSuffixes, options);
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
            return allowedSourceBoneNames ? null : converted;
        }

        const bones = {};
        Object.entries(converted.bones).forEach(function (entry) {
            const boneName = entry[0];
            const boneTrack = entry[1];
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
     * 展开动作输入文件里的动作块。
     */
    function getActionEntries(animationFiles) {
        const entries = [];
        animationFiles.forEach(function (file, fileIndex) {
            const json = file.json || file.animationJson || file;
            if (!json || !json.animations || typeof json.animations !== "object") {
                throw new Error(`${file.name || `文件 ${fileIndex + 1}`} 缺少 animations 字段。`);
            }

            Object.keys(json.animations).forEach(function (animationName) {
                entries.push({
                    id: `${fileIndex}:${animationName}`,
                    fileIndex,
                    animationName,
                    body: json.animations[animationName],
                });
            });
        });
        if (!entries.length) {
            throw new Error("至少需要一个动作块。");
        }
        return entries;
    }

    /**
     * 生成动作 key，外部传入的 actionKeys 优先。
     */
    function buildActionKeys(entries, outputPrefix, actionKeyOverrides, options) {
        const actionKeys = {};
        const usedSuffixes = new Set();
        const usedKeys = new Set();
        entries.forEach(function (entry, index) {
            const override = actionKeyOverrides[entry.id] || actionKeyOverrides[entry.animationName];
            const suffix = buildUniqueAnimationName(entry.animationName, index, usedSuffixes, options);
            let actionKey = normalizeAnimationKey(override) || `${outputPrefix}.${suffix}`;
            let duplicateIndex = 2;
            while (usedKeys.has(actionKey)) {
                actionKey = `${outputPrefix}.${suffix}_${duplicateIndex}`;
                duplicateIndex += 1;
            }
            usedKeys.add(actionKey);
            actionKeys[entry.id] = actionKey;
        });
        return actionKeys;
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
        Object.entries(bones).forEach(function (entry) {
            const boneName = entry[0];
            const boneTrack = entry[1];
            const targetName = getPlayerBoneTargetName(boneName) || boneName;
            convertedBones[targetName] = mergeBoneTracks(convertedBones[targetName], boneTrack);
        });
        return convertedBones;
    }

    /**
     * 补齐 PE 玩家骨骼空轨道并稳定输出顺序。
     */
    function ensurePePlayerBones(convertedBones) {
        const orderedBones = {};
        PE_PLAYER_BONE_NAMES.forEach(function (boneName) {
            orderedBones[boneName] = convertedBones[boneName] || {};
        });

        Object.entries(convertedBones).forEach(function (entry) {
            const boneName = entry[0];
            const boneTrack = entry[1];
            if (Object.prototype.hasOwnProperty.call(orderedBones, boneName)) {
                return;
            }
            orderedBones[boneName] = boneTrack;
        });

        return orderedBones;
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
     * 统计输入骨骼名，避免重命名撞上后续原骨骼。
     */
    function countSourceBoneNames(sourceBones) {
        const counts = {};
        sourceBones.forEach(function (bone) {
            if (!bone || !bone.name) {
                return;
            }
            const boneName = String(bone.name);
            counts[boneName] = (counts[boneName] || 0) + 1;
        });
        return counts;
    }

    /**
     * 从 PNG 文件头读取宽高。
     */
    async function readPngSize(texturePng) {
        const bytes = await readBinaryBytes(texturePng, 24);
        if (bytes.length < 24 || bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) {
            return { width: 0, height: 0 };
        }
        return {
            width: readUint32Be(bytes, 16),
            height: readUint32Be(bytes, 20),
        };
    }

    /**
     * 读取 Blob / ArrayBuffer / TypedArray 的前 N 个字节。
     */
    async function readBinaryBytes(value, maxLength) {
        if (value && typeof value.arrayBuffer === "function") {
            const blobPart = typeof value.slice === "function" ? value.slice(0, maxLength) : value;
            const buffer = await blobPart.arrayBuffer();
            return new Uint8Array(buffer);
        }
        if (value instanceof ArrayBuffer) {
            return new Uint8Array(value, 0, Math.min(value.byteLength, maxLength));
        }
        if (ArrayBuffer.isView(value)) {
            return new Uint8Array(value.buffer, value.byteOffset, Math.min(value.byteLength, maxLength));
        }
        return new Uint8Array();
    }

    /**
     * 读取大端 32 位无符号整数。
     */
    function readUint32Be(bytes, offset) {
        return ((bytes[offset] << 24) >>> 0)
            + (bytes[offset + 1] << 16)
            + (bytes[offset + 2] << 8)
            + bytes[offset + 3];
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
     * 规范化动作 key 前缀，允许调用方只传基础名。
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
        const englishText = normalizeAnimationNameToEnglish(value, {});
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
    function buildUniqueAnimationName(animationName, index, usedNames, options) {
        const baseName = normalizeAnimationNameToEnglish(animationName, options) || `${FALLBACK_ACTION_PREFIX}_${index + 1}`;
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
    function normalizeAnimationNameToEnglish(value, options) {
        const sourceText = String(value || "").trim();
        if (!sourceText) {
            return "";
        }

        const pinyinFunction = getPinyinFunction(options);
        const pinyinText = pinyinFunction
            ? pinyinFunction(sourceText, {
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
     * 获取拼音转换函数。
     */
    function getPinyinFunction(options) {
        if (options && typeof options.pinyin === "function") {
            return options.pinyin;
        }
        return global.pinyinPro && typeof global.pinyinPro.pinyin === "function"
            ? global.pinyinPro.pinyin
            : null;
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
     * 获取 geo 的第一个 geometry 对象。
     */
    function getFirstGeometry(json) {
        if (!json || !Array.isArray(json["minecraft:geometry"])) {
            return null;
        }
        return json["minecraft:geometry"][0] || null;
    }

    /**
     * 深拷贝普通 JSON 数据。
     */
    function deepClone(value) {
        return JSON.parse(JSON.stringify(value));
    }

    global.BetterPcToPe = {
        convertCostume,
        splitCostume,
        splitCostumeArmor,
        convertPlayerActions,
        createCostumeSplitPlan,
        createCostumeArmorSplitPlan,
        version: "1.1.0",
    };
})(typeof window !== "undefined" ? window : globalThis);
