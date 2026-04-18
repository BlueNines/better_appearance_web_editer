# Web 编辑器多动画控制器 / 多渲染控制器改造方案

## 1. 范围与结论

本次分析只针对 `web_editer` 当前实现，目标是让编辑器支持：

- 多个动画控制器
- 多个渲染控制器
- 保持现有插件端与客户端组件的导出格式兼容
- 尽量只改 `web_editer`，不碰插件和组件代码

结论先说：

当前项目的服务端插件与客户端组件，本身已经兼容 `render`、`animate`、`animate_controller` 的列表格式。真正限制多控制器的，不是后端或组件，而是 `web_editer` 自己的内部数据模型仍然把“渲染控制器”和“动画控制器”写死成单值。

所以这次改造的核心不是“发明新协议”，而是把 `web_editer` 从“单控制器单表单”改成“控制器列表 + 全局动画键库”的结构。

## 2. 当前兼容格式确认

### 2.1 服务端插件配置格式已经支持列表

插件端 [`LivingActionEffectConfig.java`](/Users/28315/Desktop/Better项目/BetterAppearance插件/src/main/java/pixeltech/bluenine/betterappearance/entity/config/register/action/living/LivingActionEffectConfig.java) 读取配置时使用的是：

- `section.getMapList("render")`
- `section.getMapList("animate")`
- `section.getMapList("animate_controller")`

这说明插件端天然支持：

```yml
render:
  - controller: controller.render.xxx.a
    condition: ""
  - controller: controller.render.xxx.b
    condition: "query.is_baby"

animate:
  - key: idle
    name: animation.xxx.idle
  - key: walk
    name: animation.xxx.walk
  - key: attack
    name: animation.xxx.attack

animate_controller:
  - key: default
    name: controller.animation.xxx.default
  - key: combat
    name: controller.animation.xxx.combat
```

### 2.2 客户端组件应用层已经按列表循环

组件端 [`AppearanceMethod.py`](/Users/28315/Desktop/Better项目/BetterAppearance组件/behavior_packs/better_appearance_beh/better_appearance_scripts/client/better_appearance/entity_system/AppearanceMethod.py) 在应用配置时，对下面三项都是 `for` 循环：

- `render`
- `animate`
- `animate_controller`

因此多控制器格式已经成立，不需要改组件协议。

### 2.3 `client_entity.json` 也已经是列表格式

当前 `web_editer` 生成的 `client_entity.json` 里，两个关键字段本来就是数组：

```json
"animation_controllers": [
  { "default": "controller.animation.entity_idle.default" },
  { "scale": "controller.animation.auto.scale" }
],
"render_controllers": [
  "controller.render.entity_default.third_person"
]
```

所以最终导出目标也不是问题，问题只在编辑器目前只会生成一个业务控制器。

## 3. 当前 Web 编辑器的真实限制点

当前核心文件是 [`app.js`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)。

### 3.1 数据模型仍然是单值

当前每个实体只保存：

- `entity.renderController`
- `entity.animateController`
- `entity.animationMappings`

对应创建逻辑在：

- [`createEntity()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

这意味着：

- 渲染控制器只能选一个
- 动画控制器只能选一个
- 动画槽位映射完全依赖这一个控制器的 `slots`

### 3.2 动画导出完全绑死单控制器

当前导出动画列表的方式是：

- 先通过 `getControllerSlots(entity.animateController)` 取得这个单控制器的槽位
- 再从 `entity.animationMappings` 里挑出这些槽位
- 最终生成 `animate`

关键代码：

- [`createAnimateList()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)
- [`normalizeAnimationJson()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

问题是：

- 一旦有两个动画控制器，当前逻辑不知道该以谁的槽位为准
- 如果两个控制器各自引用不同的 key，当前结构无法合并
- 如果两个控制器引用了同一个 key，当前 UI 也没法表达“全局动画 key”和“控制器绑定”其实是两个概念

### 3.3 渲染绑定只从单个渲染控制器推导

当前渲染绑定由：

- [`collectRenderBindings()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

内部调用：

- `getRenderControllerPreset(entity.renderController)`

也就是说：

- `geometry keys`
- `texture keys`
- `material keys`

都只来自一个渲染控制器

如果以后同时挂多个渲染控制器，当前编辑器完全不知道应该对多个控制器的 key 求并集。

### 3.4 表单界面也是单选

当前 Inspector 区只有：

- 一个渲染控制器 `select`
- 一个动画控制器 `select`
- 一组基于单控制器槽位渲染出来的动作槽位映射

这决定了它在 UI 层就已经不可能表达多控制器。

### 3.5 `controller-manifest` 目前只提供“控制器 -> 元信息”

当前 [`controller-manifest.js`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/controller-manifest.js) 和生成脚本 [`generate-controller-manifest.js`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/scripts/generate-controller-manifest.js) 能提供：

- 动画控制器名称
- 动画控制器可能用到的槽位列表 `slots`
- 渲染控制器名称
- 渲染控制器涉及的 `geometryKeys / textureKeys / materialKeys / partVisibilityKeys`

这已经够做多控制器编辑器了，但它提供的是“单个控制器的元信息”，不是当前实体的配置结构。

## 4. 改造的正确方向

这次不要走“把单值改成数组然后到处套 if”这种方案。

更合适的结构应该是把三件事拆开：

1. 全局动画资源键库
2. 动画控制器绑定列表
3. 渲染控制器列表

这样数据关系才是顺的。

### 4.1 动画资源键库应该独立

最终导出的 `animate` 本质上是：

```yml
animate:
  - key: idle
    name: animation.squirrel.idle
  - key: walk
    name: animation.squirrel.walk
  - key: attack
    name: animation.squirrel.attack
```

这里的 `key` 是“全局动画键”，不是某一个控制器私有的数据。

所以编辑器内部应该直接存成：

```js
entity.animateEntries = [
  { id: "a1", key: "idle", sourceAnimation: "idle" },
  { id: "a2", key: "walk", sourceAnimation: "move" },
  { id: "a3", key: "attack", sourceAnimation: "attack_1" }
];
```

这样做有三个好处：

- 多个动画控制器都可以共享同一套动画 key
- 动画导出不再依赖某一个控制器
- 即使将来控制器里出现 `hurt`、`death`、`cast` 这类自定义 key，也可以直接编辑，不会被单控制器槽位限制住

### 4.2 动画控制器应改成绑定列表

当前的单值：

```js
entity.animateController = "controller.animation.entity_idle_walk.default"
```

应该改成：

```js
entity.animationControllerBindings = [
  {
    id: "ctrl1",
    key: "default",
    controller: "controller.animation.entity_idle_walk.default"
  },
  {
    id: "ctrl2",
    key: "combat",
    controller: "controller.animation.entity_combat.default"
  }
];
```

说明：

- `key` 对应导出时 `animate_controller` 的 `key`
- `controller` 对应导出时 `name`
- 顺序要保留
- `key` 必须唯一

注意：

- 系统自动缩放控制器 `scale -> controller.animation.auto.scale` 仍建议保留为“系统内置项”，不要让用户在业务控制器列表里手动编辑
- 用户自定义项中，应该禁止占用 `scale` 这个 key

### 4.3 渲染控制器也应改成列表

当前的单值：

```js
entity.renderController = "controller.render.entity_default.third_person"
```

应该改成：

```js
entity.renderControllers = [
  {
    id: "rc1",
    controller: "controller.render.entity_default.third_person",
    condition: ""
  },
  {
    id: "rc2",
    controller: "controller.render.entity_glow.third_person",
    condition: "query.is_angry"
  }
];
```

说明：

- 对 `yml` 导出，`condition` 必须保留
- 对 `client_entity.json` 导出，只写控制器名数组，不写 `condition`
- 列表顺序要保留，因为渲染控制器顺序可能影响效果

## 5. 推荐的 Web 编辑器内部模型

建议把单实体结构改成下面这样：

```js
{
  id,
  baseName,
  identifier,
  resourceSubdir,
  files: {
    texture,
    geometry,
    animation
  },
  entityProfile,

  animateEntries: [
    { id, key, sourceAnimation }
  ],

  animationControllerBindings: [
    { id, key, controller }
  ],

  renderControllers: [
    { id, controller, condition }
  ]
}
```

其中：

- `animateEntries` 负责导出 `animate` 和裁剪 `animation.json`
- `animationControllerBindings` 负责导出 `animate_controller` 和 `client_entity.json.animation_controllers`
- `renderControllers` 负责导出 `render` 和 `client_entity.json.render_controllers`

## 6. 导出格式应该怎么落地

### 6.1 `yml` 导出

改造后目标格式：

```yml
松鼠:
  entityIdentifier: netease:squirrel
  geometry:
    - key: default
      name: geometry.squirrel
  texture:
    - key: default
      name: textures/entity/monster/squirrel
  render:
    - controller: controller.render.entity_default.third_person
      condition: ""
    - controller: controller.render.entity_glow.third_person
      condition: "query.is_angry"
  animate:
    - key: idle
      name: animation.squirrel.idle
    - key: walk
      name: animation.squirrel.walk
    - key: attack
      name: animation.squirrel.attack
  animate_controller:
    - key: default
      name: controller.animation.entity_idle_walk.default
    - key: combat
      name: controller.animation.entity_combat.default
  entity_profile:
    ...
```

### 6.2 `client_entity.json` 导出

目标格式：

```json
"animation_controllers": [
  { "default": "controller.animation.entity_idle_walk.default" },
  { "combat": "controller.animation.entity_combat.default" },
  { "scale": "controller.animation.auto.scale" }
],
"render_controllers": [
  "controller.render.entity_default.third_person",
  "controller.render.entity_glow.third_person"
]
```

### 6.3 `animation.json` 导出

导出逻辑不应再依赖“当前选中的唯一动画控制器”，而是改成：

- 以 `animateEntries` 里实际存在的 key 为准
- 将 `sourceAnimation` 指向的原始动画块重命名为 `animation.${baseName}.${key}`

这样任何控制器只要引用这些 key，就都能工作。

## 7. UI 设计建议

为了不把界面做成一堆嵌套面板，建议拆成三块。

### 7.1 动画资源键库

单独一个 section：

- 每行一条 `动画键`
- 字段：
  - `key`
  - `源动画名`
- 支持：
  - 新增
  - 删除
  - 复制
  - 从动作文件自动推荐一批

这块决定最终 `animate` 和导出的 `animation.json`。

### 7.2 动画控制器列表

单独一个 section：

- 每条控制器一张 card
- 字段：
  - `绑定 key`
  - `控制器名称`
- 辅助展示：
  - 该控制器从 manifest 推导出的 `slots`
  - 当前缺失了哪些动画 key

注意这里不要再直接让控制器“拥有动画映射”，否则多个控制器之间会产生重复编辑。

### 7.3 渲染控制器列表

单独一个 section：

- 每条渲染控制器一张 card
- 字段：
  - `controller`
  - `condition`
- 辅助展示：
  - 从 manifest 推导出的 `geometryKeys`
  - `textureKeys`
  - `materialKeys`
  - `partVisibilityKeys`

### 7.4 几个必要的小功能

- 渲染控制器列表支持排序
- 动画控制器列表支持排序
- `key` 重复时立即报错
- 预览区直接显示最终导出的 `animate_controller / render / animate`

## 8. manifest 脚本需要补到什么程度

当前 [`generate-controller-manifest.js`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/scripts/generate-controller-manifest.js) 已经能提供：

- 动画控制器 `slots`
- 渲染控制器绑定 key

这足够做第一版多控制器编辑器。

第一版不需要把 manifest 做得过于复杂。

建议只增加两点：

1. 保留 `source`
   这样 UI 里可以直接显示控制器来自哪个 json 文件。

2. 动画控制器的 `slots` 去重和排序继续保留
   用它做缺失校验和推荐，而不是做强限制。

也就是说：

- manifest 负责“提示”
- 实体配置负责“最终导出”

不要让 manifest 反过来决定实体数据模型。

## 9. 代码层面的具体改造点

下面这些位置会是主要施工点。

### 9.1 创建实体默认结构

当前：

- `renderController`
- `animateController`
- `animationMappings`

改成：

- `renderControllers`
- `animationControllerBindings`
- `animateEntries`

位置：

- [`createEntity()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

### 9.2 动画自动推荐逻辑

当前 `recommendController()` 只会推荐一个控制器。

多控制器版本建议：

- 保留“推荐一个默认控制器”作为初始体验
- 不强行自动拆成多个控制器
- 由用户自己继续添加控制器

这样最稳，逻辑也简单。

位置：

- [`recommendController()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

### 9.3 动画导出逻辑重写

当前：

- `createAnimateList()` 依赖单控制器槽位
- `normalizeAnimationJson()` 依赖单控制器槽位

改造后：

- `createAnimateList()` 直接基于 `animateEntries`
- `normalizeAnimationJson()` 直接基于 `animateEntries`

### 9.4 渲染绑定求并集

当前：

- `collectRenderBindings(entity)` 只看一个控制器

改造后：

- 遍历 `entity.renderControllers`
- 对所有选中渲染控制器的 `geometryKeys / textureKeys / materialKeys / partVisibilityKeys` 求并集

### 9.5 `client_entity.json` 导出改写

当前：

- `animation_controllers` 只导出一个业务控制器 + 一个系统 scale
- `render_controllers` 只导出一个

改造后：

- `animation_controllers` 遍历 `animationControllerBindings` 再追加系统 `scale`
- `render_controllers` 遍历 `renderControllers`

位置：

- [`createClientEntityJson()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

### 9.6 `yml` 导出改写

当前：

- `render` 只写一条
- `animate_controller` 只写一条

改造后：

- `render` 遍历 `renderControllers`
- `animate_controller` 遍历 `animationControllerBindings`

位置：

- [`createYmlText()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)

### 9.7 Inspector 表单重做

当前 Inspector 的“渲染控制器 / 动画控制器 / 动作槽位映射”三块要拆分重组。

建议保留现有视觉风格，只把内容换成：

- 动画资源键库 section
- 动画控制器列表 section
- 渲染控制器列表 section

这样基本只改 [`renderInspector()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js) 和 [`bindInspectorEvents()`](/Users/28315/Desktop/Better项目/BetterAppearance插件/web_editer/app.js)，不需要推倒重写整站结构。

## 10. 兼容旧数据的迁移策略

这个很重要，建议第一天就做掉。

### 10.1 旧字段自动升级

如果实体仍然是旧结构：

```js
{
  renderController,
  animateController,
  animationMappings
}
```

则进入编辑器时自动转成：

```js
renderControllers = [
  { id, controller: oldRenderController, condition: "" }
]

animationControllerBindings = [
  { id, key: "default", controller: oldAnimateController }
]

animateEntries = old animationMappings 转出来的数组
```

### 10.2 保留旧默认体验

新建实体时仍然可以：

- 自动带一个默认渲染控制器
- 自动带一个默认动画控制器 `default`

这样旧用户不会觉得突然没法用了。

## 11. 风险点与约束

### 11.1 `animation controller binding key` 必须唯一

例如：

- `default`
- `combat`
- `skill_layer`

这些 key 不能重复。

### 11.2 `scale` 建议保留为系统保留字

因为当前编辑器和组件链都默认把：

- `scale -> controller.animation.auto.scale`

作为系统能力注入。

所以用户自定义动画控制器时，建议不允许使用 `scale` 作为绑定 key。

### 11.3 多渲染控制器时顺序有意义

所以列表必须支持排序，不能简单转成集合。

### 11.4 manifest 只能做“提示”，不能做“真相”

有些复杂控制器里的表达式或动态引用，不一定能被 manifest 完整解析出来。

因此：

- manifest 适合拿来提示 key、给 UI 推荐
- 真正导出的数据，必须来自实体当前编辑结果

## 12. 推荐实施顺序

建议按下面顺序做，最稳。

### 第一阶段：先把数据模型改对

- `createEntity`
- 旧数据迁移
- `createAnimateList`
- `normalizeAnimationJson`
- `createClientEntityJson`
- `createYmlText`
- `collectRenderBindings`

这一步完成后，哪怕 UI 还没完全重做，也已经具备多控制器导出能力。

### 第二阶段：再重做 Inspector

- 动画资源键库编辑区
- 动画控制器列表编辑区
- 渲染控制器列表编辑区

### 第三阶段：最后补体验

- 排序
- 重复 key 校验
- 缺失引用警告
- 一键从 manifest 推荐控制器

## 13. 最终建议

如果只追求“尽快可用”，最小可行版本应该这样做：

1. 先把内部结构改成：
   - `animateEntries`
   - `animationControllerBindings`
   - `renderControllers`
2. 先实现导出和旧数据兼容
3. UI 先做成基础列表编辑，不急着做花哨交互
4. `manifest` 继续只做推荐和校验，不要让它控制导出结构

这样改出来的编辑器会比现在稳很多，因为它终于和真实导出格式一一对应了。

最关键的一点是：

**多动画控制器的核心，不是“多选几个控制器”，而是把“动画资源键库”和“动画控制器绑定”拆开。**

这一点拆对了，后面再扩更复杂的控制器也不会乱。
