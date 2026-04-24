const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Identity (update these before submitting) ───────────────────────────────
const USER_ID = "Vaishnavi_22082005"; // e.g. "johndoe_17091999"
const EMAIL_ID = "a.vaishnavi2205@gmail.com";
const COLLEGE_ROLL_NUMBER = "RA2311003011723";
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate a single entry.
 * Rules: must be X->Y, X and Y each a single A-Z letter, not a self-loop.
 */
function isValid(entry) {
  if (typeof entry !== "string") return false;
  const trimmed = entry.trim();
  // Single uppercase letter -> single uppercase letter
  return /^[A-Z]->[A-Z]$/.test(trimmed);
}

/**
 * Parse a valid entry into { parent, child }.
 */
function parseEdge(entry) {
  const t = entry.trim();
  return { parent: t[0], child: t[3] };
}

/**
 * Build all hierarchies from a set of valid, deduplicated edges.
 * Returns an array of hierarchy objects.
 */
function buildHierarchies(edges) {
  // Step 1: Collect all nodes and determine parent->children relationships.
  // Multi-parent rule: first-encountered parent wins.
  const childParentMap = {}; // child -> first parent only
  const parentChildrenMap = {}; // parent -> [children in order]
  const allNodes = new Set();

  for (const { parent, child } of edges) {
    allNodes.add(parent);
    allNodes.add(child);

    if (!parentChildrenMap[parent]) parentChildrenMap[parent] = [];

    // Multi-parent: only assign first parent
    if (childParentMap[child] === undefined) {
      childParentMap[child] = parent;
      parentChildrenMap[parent].push(child);
    }
    // Silently discard if child already has a parent
  }

  // Step 2: Find roots (nodes that are never a child in any accepted edge).
  // Since we used childParentMap (first-parent wins), root = node not in childParentMap keys.
  const roots = [];
  for (const node of allNodes) {
    if (childParentMap[node] === undefined) {
      roots.push(node);
    }
  }
  roots.sort();

  // Step 3: Group nodes into connected components using Union-Find on original edges
  // (before multi-parent pruning) to handle cycles / pure-cycle groups.
  const parent = {};
  function find(x) {
    if (parent[x] === undefined) parent[x] = x;
    if (parent[x] !== x) parent[x] = find(parent[x]);
    return parent[x];
  }
  function union(a, b) {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  }

  for (const { parent: p, child: c } of edges) {
    union(p, c);
  }

  // Group nodes by component
  const components = {};
  for (const node of allNodes) {
    const rep = find(node);
    if (!components[rep]) components[rep] = new Set();
    components[rep].add(node);
  }

  const hierarchies = [];

  // For each component, determine its root(s) and build the tree.
  const processedComponents = new Set();

  for (const node of allNodes) {
    const rep = find(node);
    if (processedComponents.has(rep)) continue;
    processedComponents.add(rep);

    const componentNodes = components[rep];

    // Find roots within this component
    const componentRoots = [...componentNodes].filter(
      (n) => childParentMap[n] === undefined
    );
    componentRoots.sort();

    if (componentRoots.length === 0) {
      // Pure cycle — no root exists; use lexicographically smallest node
      const cycleRoot = [...componentNodes].sort()[0];
      hierarchies.push({ root: cycleRoot, tree: {}, has_cycle: true });
    } else {
      // One or more roots (could be multiple independent subtrees in same component —
      // but with the multi-parent rule they're actually separate trees)
      for (const root of componentRoots) {
        // Detect cycle within this rooted subtree via DFS
        const visited = new Set();
        let hasCycle = false;

        function detectCycle(node, stack) {
          if (stack.has(node)) { hasCycle = true; return; }
          if (visited.has(node)) return;
          visited.add(node);
          stack.add(node);
          for (const child of (parentChildrenMap[node] || [])) {
            detectCycle(child, stack);
          }
          stack.delete(node);
        }
        detectCycle(root, new Set());

        if (hasCycle) {
          hierarchies.push({ root, tree: {}, has_cycle: true });
        } else {
          // Build nested tree object and compute depth
          function buildTree(node) {
            const obj = {};
            for (const child of (parentChildrenMap[node] || [])) {
              obj[child] = buildTree(child);
            }
            return obj;
          }

          function computeDepth(node) {
            const children = parentChildrenMap[node] || [];
            if (children.length === 0) return 1;
            return 1 + Math.max(...children.map(computeDepth));
          }

          const tree = {};
          tree[root] = buildTree(root);
          const depth = computeDepth(root);
          hierarchies.push({ root, tree, depth });
        }
      }
    }
  }

  // Sort hierarchies: non-cyclic by root alpha, then cyclic
  hierarchies.sort((a, b) => a.root.localeCompare(b.root));

  return hierarchies;
}

/**
 * Build summary from hierarchies.
 */
function buildSummary(hierarchies) {
  const trees = hierarchies.filter((h) => !h.has_cycle);
  const cycles = hierarchies.filter((h) => h.has_cycle);

  let largestRoot = null;
  let largestDepth = -1;

  for (const h of trees) {
    if (
      h.depth > largestDepth ||
      (h.depth === largestDepth && h.root < largestRoot)
    ) {
      largestDepth = h.depth;
      largestRoot = h.root;
    }
  }

  return {
    total_trees: trees.length,
    total_cycles: cycles.length,
    largest_tree_root: largestRoot,
  };
}

// ─── POST /bfhl ──────────────────────────────────────────────────────────────
app.post("/bfhl", (req, res) => {
  const { data } = req.body;

  if (!Array.isArray(data)) {
    return res.status(400).json({ error: "Request body must contain a 'data' array." });
  }

  const invalidEntries = [];
  const duplicateEdges = [];
  const seenEdges = new Set();
  const validEdges = [];

  for (const entry of data) {
    if (typeof entry !== "string") {
      invalidEntries.push(String(entry));
      continue;
    }

    const trimmed = entry.trim();

    // Self-loop check before general validation
    if (/^[A-Z]->[A-Z]$/.test(trimmed) && trimmed[0] === trimmed[3]) {
      invalidEntries.push(entry);
      continue;
    }

    if (!isValid(entry)) {
      invalidEntries.push(entry);
      continue;
    }

    const { parent, child } = parseEdge(entry);
    const key = `${parent}->${child}`;

    if (seenEdges.has(key)) {
      if (!duplicateEdges.includes(key)) {
        duplicateEdges.push(key);
      }
    } else {
      seenEdges.add(key);
      validEdges.push({ parent, child });
    }
  }

  const hierarchies = buildHierarchies(validEdges);
  const summary = buildSummary(hierarchies);

  return res.json({
    user_id: USER_ID,
    email_id: EMAIL_ID,
    college_roll_number: COLLEGE_ROLL_NUMBER,
    hierarchies,
    invalid_entries: invalidEntries,
    duplicate_edges: duplicateEdges,
    summary,
  });
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", message: "BFHL API running" }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));