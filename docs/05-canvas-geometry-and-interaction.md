> **Status.** Historical notes. Not the shipped product spec. Do not use this file as an implementation checklist. Do not extend reverse-engineered protocol detail from it. See [README](../README.md) and [SHIPPED.md](./SHIPPED.md).

# 05. 无限画布几何变换、6线智能吸附与多选缩放算法

---

## 1. 2D 坐标系与无限仿射变换矩阵

在前端设计器中，画布必须支持平移（Pan）、缩放（Zoom）以及多级嵌套容器内的局部坐标转换。Lunagraph 底层依托标准 Web API `DOMMatrix` 与逆矩阵变换实现精确映射。

### 核心坐标系定义
- **屏幕视口坐标 (Viewport Coordinates)**：鼠标指针相对于浏览器窗口的物理像素坐标 $(X_{screen}, Y_{screen})$。
- **世界画布坐标 (World Canvas Coordinates)**：画布世界中的绝对逻辑坐标 $(X_{world}, Y_{world})$。
- **组件局部坐标 (Local Coordinates)**：组件内部相对于其父容器原点的相对坐标 $(X_{local}, Y_{local})$。

### 仿射变换矩阵推导
画布主容器应用 CSS 变换：
$$\mathbf{M} = \begin{bmatrix} s & 0 & tx \\ 0 & s & ty \\ 0 & 0 & 1 \end{bmatrix}$$
其中 $s$ 为当前画布缩放因子（Zoom Level，默认 1.0），$(tx, ty)$ 为视口平移偏移量。

#### 屏幕坐标向世界坐标的逆变换
当用户在屏幕上点击某个像素时，求对应世界画布位置：
$$\begin{bmatrix} X_{world} \\ Y_{world} \\ 1 \end{bmatrix} = \mathbf{M}^{-1} \begin{bmatrix} X_{screen} \\ Y_{screen} \\ 1 \end{bmatrix} = \begin{bmatrix} \frac{X_{screen} - tx}{s} \\ \frac{Y_{screen} - ty}{s} \\ 1 \end{bmatrix}$$

---

## 2. 6线智能几何吸附算法 (`snapping.ts`)

在拖拽或缩放组件时，系统提供类似 Figma 的动态磁吸对齐，并高亮红色/粉色辅助对齐线。

### 吸附参考线模型
每个矩形节点由 **3 条水平基准线** 与 **3 条垂直基准线** 确定：

```
垂直基准线 (Vertical):
  Left (x)          Center (x + w/2)     Right (x + w)
    │                      │                 │
    ┌──────────────────────┬─────────────────┐ ── Top (y)
    │                                        │
    │                                        │ ── Center (y + h/2)  水平基准线 (Horizontal)
    │                                        │
    └──────────────────────┴─────────────────┘ ── Bottom (y + h)
```

### 吸附匹配与最小距离决策
当拖拽活动元素 $A$ 时：
1. **构建候选集**：收集当前视口内所有其他可见元素 $B_1, B_2, \dots, B_n$ 的 6 条参考线。
2. **计算距离差**：
   $$\Delta x_{i,j} = |X_{line, A}^{(i)} - X_{line, B}^{(j)}|, \quad i,j \in \{\text{Near}, \text{Center}, \text{Far}\}$$
   $$\Delta y_{i,j} = |Y_{line, A}^{(i)} - Y_{line, B}^{(j)}|, \quad i,j \in \{\text{Near}, \text{Center}, \text{Far}\}$$
3. **阈值判定（Snap Threshold）**：
   默认吸附阈值为 5 像素（除以当前缩放比例以保持屏幕物理像素感知一致）：
   $$\text{Threshold}_{world} = \frac{5}{s}$$
4. **施加坐标修正与辅助线渲染**：
   在阈值范围内选取 $\Delta$ 最小的对齐线，将元素坐标强行修正（Snap），并向 UI 渲染层输出对齐导引线坐标区间。

---

## 3. 伴随几何多选缩放算法 (`multiResize.ts`)

当用户同时选中多个元素或拖拽复合组的缩放手柄（8 个方向：`n`, `s`, `e`, `w`, `ne`, `nw`, `se`, `sw`）时，系统需保持各子元素相对几何比例缩放。

### 官方源码算法解构 (`companionGeometry`)
```typescript
/**
 * 伴随几何缩放算法
 * @param start 元素初始几何包围盒 { left, top, width, height }
 * @param handle 当前拖拽的控制手柄 ("nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w")
 * @param deltaWidth 宽度变化量
 * @param deltaHeight 高度变化量
 */
function companionGeometry(
  start: { left: number; top: number; width: number; height: number },
  handle: string,
  deltaWidth: number,
  deltaHeight: number
) {
  const width = Math.max(1, start.width + deltaWidth);
  const height = Math.max(1, start.height + deltaHeight);

  return {
    width,
    height,
    // 如果拖动西侧（左侧）手柄，反向补偿 left 坐标以固定右边缘
    left: handle.includes("w") ? start.left - (width - start.width) : start.left,
    // 如果拖动北侧（顶侧）手柄，反向补偿 top 坐标以固定底边缘
    top: handle.includes("n") ? start.top - (height - start.height) : start.top
  };
}
```

---

## 4. 弹性流式布局与重排 (`flowLayoutChildren.ts` & `reorderSelection.ts`)

除了绝对坐标拖拽，画布深度支持 Flexbox / Grid 流式布局环境：
- **拖入容器检测**：当拖拽元素悬停在某个带有 `flex` 或 `grid` 属性的容器上方时，计算悬停位置在容器子元素列表中的插入索引（`insertBeforeIndex`）。
- **流式占位指示器 (Drop Indicator)**：在相邻子元素之间插入蓝色指示条，预览松手后的 DOM 排版位置。
- **源码映射操作**：松手后不仅更新画布 Store 中的 `childrenByParent` 关系，同时触发编译器的 `canvas_insert` 或 `sourceEdit` 对源码中的 JSX 子节点顺序进行同等就地重排。
