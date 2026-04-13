import { v4 as uuid } from "uuid";

export interface PaneLeaf {
  type: "leaf";
  id: string;
}

export interface PaneSplit {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  children: [PaneNode, PaneNode];
}

export type PaneNode = PaneLeaf | PaneSplit;

export function createLeaf(id?: string): PaneLeaf {
  return { type: "leaf", id: id || uuid() };
}

export function splitLeaf(tree: PaneNode, leafId: string, direction: "horizontal" | "vertical", newPaneId: string): PaneNode {
  if (tree.type === "leaf") {
    if (tree.id === leafId) {
      return {
        type: "split",
        id: uuid(),
        direction,
        ratio: 0.5,
        children: [tree, createLeaf(newPaneId)],
      };
    }
    return tree;
  }
  return {
    ...tree,
    children: [
      splitLeaf(tree.children[0], leafId, direction, newPaneId),
      splitLeaf(tree.children[1], leafId, direction, newPaneId),
    ],
  };
}

export function removeLeaf(tree: PaneNode, leafId: string): PaneNode | null {
  if (tree.type === "leaf") {
    return tree.id === leafId ? null : tree;
  }
  const [first, second] = tree.children;
  if (first.type === "leaf" && first.id === leafId) return second;
  if (second.type === "leaf" && second.id === leafId) return first;

  const newFirst = removeLeaf(first, leafId);
  if (newFirst !== first) return newFirst === null ? second : { ...tree, children: [newFirst, second] };

  const newSecond = removeLeaf(second, leafId);
  if (newSecond !== second) return newSecond === null ? first : { ...tree, children: [first, newSecond] };

  return tree;
}

export function getAllLeafIds(tree: PaneNode): string[] {
  if (tree.type === "leaf") return [tree.id];
  return [...getAllLeafIds(tree.children[0]), ...getAllLeafIds(tree.children[1])];
}

export function updateRatio(tree: PaneNode, splitId: string, ratio: number): PaneNode {
  if (tree.type === "leaf") return tree;
  if (tree.id === splitId) return { ...tree, ratio };
  return {
    ...tree,
    children: [
      updateRatio(tree.children[0], splitId, ratio),
      updateRatio(tree.children[1], splitId, ratio),
    ],
  };
}
