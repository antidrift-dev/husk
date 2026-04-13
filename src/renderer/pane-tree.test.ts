import { describe, it, expect } from "vitest";
import { createLeaf, splitLeaf, removeLeaf, getAllLeafIds, updateRatio, PaneNode, PaneSplit } from "./pane-tree";

describe("pane-tree", () => {
  // ---- createLeaf ----
  describe("createLeaf", () => {
    it("creates a leaf with given id", () => {
      const leaf = createLeaf("abc");
      expect(leaf).toEqual({ type: "leaf", id: "abc" });
    });

    it("creates a leaf with generated uuid", () => {
      const leaf = createLeaf();
      expect(leaf.type).toBe("leaf");
      expect(leaf.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it("generates unique ids", () => {
      const a = createLeaf();
      const b = createLeaf();
      expect(a.id).not.toBe(b.id);
    });
  });

  // ---- splitLeaf ----
  describe("splitLeaf", () => {
    it("splits a single leaf vertically", () => {
      const tree = createLeaf("a");
      const result = splitLeaf(tree, "a", "vertical", "b");
      expect(result.type).toBe("split");
      const s = result as PaneSplit;
      expect(s.direction).toBe("vertical");
      expect(s.ratio).toBe(0.5);
      expect(s.children[0]).toEqual({ type: "leaf", id: "a" });
      expect(s.children[1]).toEqual({ type: "leaf", id: "b" });
    });

    it("splits a single leaf horizontally", () => {
      const result = splitLeaf(createLeaf("a"), "a", "horizontal", "b") as PaneSplit;
      expect(result.direction).toBe("horizontal");
    });

    it("preserves original leaf as first child", () => {
      const result = splitLeaf(createLeaf("original"), "original", "vertical", "new") as PaneSplit;
      expect(result.children[0].id).toBe("original");
      expect(result.children[1].id).toBe("new");
    });

    it("splits left child of existing split", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "a", "horizontal", "c");
      const ids = getAllLeafIds(tree);
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids).toContain("c");
      expect(ids).toHaveLength(3);
    });

    it("splits right child of existing split", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      expect(getAllLeafIds(tree)).toEqual(["a", "b", "c"]);
    });

    it("handles deep nesting (4 levels)", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      tree = splitLeaf(tree, "c", "vertical", "d");
      expect(getAllLeafIds(tree)).toEqual(["a", "b", "c", "d"]);
    });

    it("returns tree unchanged if leaf id not found", () => {
      const tree = createLeaf("a");
      const result = splitLeaf(tree, "nonexistent", "vertical", "b");
      expect(result).toEqual(tree);
    });

    it("returns tree unchanged if split target not in complex tree", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      const before = JSON.stringify(tree);
      const result = splitLeaf(tree, "nonexistent", "vertical", "c");
      expect(JSON.stringify(result)).toBe(before);
    });

    it("generates unique split node ids", () => {
      const tree = createLeaf("a");
      const s1 = splitLeaf(tree, "a", "vertical", "b") as PaneSplit;
      const s2 = splitLeaf(s1, "b", "horizontal", "c") as PaneSplit;
      expect(s1.id).toBeTruthy();
      if (s2.type === "split" && s2.children[1].type === "split") {
        expect(s2.children[1].id).not.toBe(s1.id);
      }
    });
  });

  // ---- removeLeaf ----
  describe("removeLeaf", () => {
    it("returns null when removing only leaf", () => {
      expect(removeLeaf(createLeaf("a"), "a")).toBeNull();
    });

    it("returns sibling when removing first child", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b");
      expect(removeLeaf(tree, "a")).toEqual({ type: "leaf", id: "b" });
    });

    it("returns sibling when removing second child", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b");
      expect(removeLeaf(tree, "b")).toEqual({ type: "leaf", id: "a" });
    });

    it("collapses parent split when removing from nested tree", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      // Remove b → inner split collapses to c → outer becomes split(a, c)
      const result = removeLeaf(tree, "b")!;
      const ids = getAllLeafIds(result);
      expect(ids).toContain("a");
      expect(ids).toContain("c");
      expect(ids).not.toContain("b");
      expect(ids).toHaveLength(2);
    });

    it("collapses correctly when removing deeply nested leaf", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      tree = splitLeaf(tree, "c", "vertical", "d");
      const result = removeLeaf(tree, "d")!;
      expect(getAllLeafIds(result)).toEqual(["a", "b", "c"]);
    });

    it("collapses when removing from left side of deep nested split", () => {
      // split(split(a,b), c) — remove a → should collapse to split(b, c)
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "c"); // split(a, c)
      tree = splitLeaf(tree, "a", "horizontal", "b"); // split(split(a,b), c)
      const result = removeLeaf(tree, "a")!;
      const ids = getAllLeafIds(result);
      expect(ids).toContain("b");
      expect(ids).toContain("c");
      expect(ids).not.toContain("a");
    });

    it("collapses when removing from right side of deep nested split", () => {
      // split(a, split(b,c)) — remove c → should collapse to split(a, b)
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b"); // split(a, b)
      tree = splitLeaf(tree, "b", "horizontal", "c"); // split(a, split(b,c))
      const result = removeLeaf(tree, "c")!;
      const ids = getAllLeafIds(result);
      expect(ids).toContain("a");
      expect(ids).toContain("b");
      expect(ids).not.toContain("c");
    });

    it("returns unchanged tree if leaf not found", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b");
      const result = removeLeaf(tree, "nonexistent");
      expect(result).toEqual(tree);
    });

    it("handles removing all leaves one by one", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      tree = removeLeaf(tree, "c")!;
      expect(getAllLeafIds(tree)).toEqual(["a", "b"]);
      tree = removeLeaf(tree, "a")!;
      expect(getAllLeafIds(tree)).toEqual(["b"]);
      expect(removeLeaf(tree, "b")).toBeNull();
    });
  });

  // ---- getAllLeafIds ----
  describe("getAllLeafIds", () => {
    it("returns single id for leaf", () => {
      expect(getAllLeafIds(createLeaf("x"))).toEqual(["x"]);
    });

    it("returns ids in DFS order (left to right)", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      expect(getAllLeafIds(tree)).toEqual(["a", "b"]);
    });

    it("maintains order through complex splits", () => {
      let tree: PaneNode = createLeaf("1");
      tree = splitLeaf(tree, "1", "vertical", "2");
      tree = splitLeaf(tree, "1", "horizontal", "3");
      tree = splitLeaf(tree, "2", "horizontal", "4");
      // Tree: split(split(1,3), split(2,4))
      expect(getAllLeafIds(tree)).toEqual(["1", "3", "2", "4"]);
    });
  });

  // ---- updateRatio ----
  describe("updateRatio", () => {
    it("updates ratio of target split", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b") as PaneSplit;
      const result = updateRatio(tree, tree.id, 0.7) as PaneSplit;
      expect(result.ratio).toBe(0.7);
    });

    it("preserves children when updating ratio", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b") as PaneSplit;
      const result = updateRatio(tree, tree.id, 0.3) as PaneSplit;
      expect(getAllLeafIds(result)).toEqual(["a", "b"]);
    });

    it("updates nested split ratio without affecting parent", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      const outer = tree as PaneSplit;
      const inner = outer.children[1] as PaneSplit;
      const result = updateRatio(tree, inner.id, 0.3) as PaneSplit;
      expect(result.ratio).toBe(0.5); // outer unchanged
      expect((result.children[1] as PaneSplit).ratio).toBe(0.3); // inner changed
    });

    it("returns tree unchanged if split id not found", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b");
      const result = updateRatio(tree, "nonexistent", 0.8);
      expect(result).toEqual(tree);
    });

    it("clamps are not enforced (caller responsibility)", () => {
      const tree = splitLeaf(createLeaf("a"), "a", "vertical", "b") as PaneSplit;
      const result = updateRatio(tree, tree.id, 0.99) as PaneSplit;
      expect(result.ratio).toBe(0.99);
    });
  });

  // ---- Focus cycling simulation ----
  describe("focus cycling", () => {
    it("cycles forward through all panes", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "b", "horizontal", "c");
      const ids = getAllLeafIds(tree);
      let idx = 0; // start at "a"
      idx = (idx + 1) % ids.length; expect(ids[idx]).toBe("b");
      idx = (idx + 1) % ids.length; expect(ids[idx]).toBe("c");
      idx = (idx + 1) % ids.length; expect(ids[idx]).toBe("a"); // wrapped
    });

    it("cycles backward through all panes", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      const ids = getAllLeafIds(tree);
      let idx = 0; // start at "a"
      idx = (idx - 1 + ids.length) % ids.length;
      expect(ids[idx]).toBe("b"); // wrapped backwards
    });

    it("handles single pane (no-op)", () => {
      const ids = getAllLeafIds(createLeaf("only"));
      let idx = 0;
      idx = (idx + 1) % ids.length;
      expect(ids[idx]).toBe("only");
    });
  });

  // ---- Edge cases ----
  describe("edge cases", () => {
    it("split and immediately remove new pane returns original", () => {
      const original = createLeaf("a");
      const split = splitLeaf(original, "a", "vertical", "b");
      const result = removeLeaf(split, "b");
      expect(result).toEqual(original);
    });

    it("split and immediately remove original pane returns new", () => {
      const split = splitLeaf(createLeaf("a"), "a", "vertical", "b");
      const result = removeLeaf(split, "a");
      expect(result).toEqual({ type: "leaf", id: "b" });
    });

    it("alternating vertical and horizontal splits", () => {
      let tree: PaneNode = createLeaf("a");
      tree = splitLeaf(tree, "a", "vertical", "b");
      tree = splitLeaf(tree, "a", "horizontal", "c");
      tree = splitLeaf(tree, "b", "horizontal", "d");
      tree = splitLeaf(tree, "c", "vertical", "e");
      const ids = getAllLeafIds(tree);
      expect(ids).toHaveLength(5);
      expect(new Set(ids).size).toBe(5); // all unique
    });

    it("8 panes stress test", () => {
      let tree: PaneNode = createLeaf("1");
      for (let i = 2; i <= 8; i++) {
        const ids = getAllLeafIds(tree);
        const target = ids[ids.length - 1];
        tree = splitLeaf(tree, target, i % 2 === 0 ? "vertical" : "horizontal", String(i));
      }
      expect(getAllLeafIds(tree)).toHaveLength(8);

      // Remove half
      for (let i = 8; i > 4; i--) {
        tree = removeLeaf(tree, String(i))!;
      }
      expect(getAllLeafIds(tree)).toHaveLength(4);
    });
  });
});
