const { getPool } = require('./pool');

const SEED = [
  // C++
  { language: 'cpp', name: 'push_back', signature: 'void vector<T>::push_back(const T& x)', description: 'Appends x to the end of the vector (amortized O(1)).', usecase: 'Building answer arrays incrementally, e.g. two-sum result.', example: 'vector<int> ans;\nans.push_back(i);' },
  { language: 'cpp', name: 'size', signature: 'size_t vector<T>::size() const', description: 'Returns number of elements. Use instead of .length (JS) in C++.', usecase: 'Loop bounds: for(int i=0;i<nums.size();i++).', example: 'for(int i=0;i<nums.size();i++){}' },
  { language: 'cpp', name: 'unordered_map', signature: 'unordered_map<K,V> m;', description: 'Hash map with average O(1) lookup/insert.', usecase: 'Two-sum complement lookup.', example: 'unordered_map<int,int> m;\nm[nums[i]] = i;\nif(m.count(target-nums[i])) ...' },
  { language: 'cpp', name: 'sort', signature: 'sort(first, last)', description: 'Sorts range in O(n log n).', usecase: 'Sorting nums before two-pointers.', example: 'sort(nums.begin(), nums.end());' },
  { language: 'cpp', name: 'reverse', signature: 'reverse(first, last)', description: 'Reverses range in place.', usecase: 'Reverse string/array problems.', example: "reverse(s.begin(), s.end());" },
  { language: 'cpp', name: 'count', signature: 'm.count(key)', description: 'Returns 1 if key exists in map/set, else 0.', usecase: 'Check complement existence without exceptions.', example: 'if(m.count(c)) return {m[c], i};' },
  // JS
  { language: 'javascript', name: 'length', signature: 'arr.length', description: 'Number of elements. Use instead of .size() in JS.', usecase: 'Loop bounds.', example: 'for(let i=0;i<nums.length;i++){}' },
  { language: 'javascript', name: 'map', signature: 'arr.map(fn)', description: 'Returns new array with fn applied to each element.', usecase: 'Transforming test outputs.', example: 'nums.map(x => x*2)' },
  { language: 'javascript', name: 'filter', signature: 'arr.filter(fn)', description: 'Returns elements passing predicate.', usecase: 'Removing zeroes.', example: 'nums.filter(x => x !== 0)' },
  { language: 'javascript', name: 'Map', signature: 'new Map()', description: 'Key-value store with .set/.get/.has.', usecase: 'Two-sum hash map.', example: 'const m=new Map();\nm.set(x,i);\nif(m.has(c)) ...' },
  { language: 'javascript', name: 'push', signature: 'arr.push(x)', description: 'Appends x (use instead of push_back).', usecase: 'Building results.', example: 'ans.push(i);' },
  // Python
  { language: 'python', name: 'append', signature: 'list.append(x)', description: 'Appends x (use instead of push_back).', usecase: 'Building results.', example: 'ans.append(i)' },
  { language: 'python', name: 'len', signature: 'len(x)', description: 'Length of sequence.', usecase: 'Loop bounds.', example: 'for i in range(len(nums)):' },
  { language: 'python', name: 'range', signature: 'range(n)', description: 'Sequence 0..n-1.', usecase: 'Indexed loops.', example: 'for i in range(len(nums)):' },
  { language: 'python', name: 'dict', signature: 'dict() / {}', description: 'Hash map.', usecase: 'Two-sum complement map.', example: 'm={}\nm[n]=i\nif c in m: ...' },
  { language: 'python', name: 'enumerate', signature: 'enumerate(iter)', description: 'Yields (index, value) pairs.', usecase: 'Indexed iteration without range(len).', example: 'for i,n in enumerate(nums):' },
  // C++ containers
  { language: 'cpp', name: 'vector', signature: 'vector<T> v; / vector<int> v(n, 0);', description: 'Dynamic array with O(1) random access and amortized O(1) push_back.', usecase: 'Default array type for nums/problems.', example: 'vector<int> nums = {1,2,3};' },
  { language: 'cpp', name: 'string', signature: 'string s;', description: 'Dynamic character string; s[i], s.size(), s.substr(...).', usecase: 'String problems (reverse, parentheses).', example: 'string s = "abc";\ns += "d";' },
  { language: 'cpp', name: 'stack', signature: 'stack<T> st;', description: 'LIFO container: push/pop/top, all O(1).', usecase: 'Valid parentheses, monotonic stack.', example: 'stack<char> st;\nst.push(c);\nchar t = st.top(); st.pop();' },
  { language: 'cpp', name: 'queue', signature: 'queue<T> q;', description: 'FIFO container: push/pop/front, all O(1).', usecase: 'BFS traversal.', example: 'queue<int> q;\nq.push(0);\nint x = q.front(); q.pop();' },
  { language: 'cpp', name: 'priority_queue', signature: 'priority_queue<T> pq;', description: 'Max-heap by default; push/pop/top in O(log n).', usecase: 'Top-K, merge K lists.', example: 'priority_queue<int> pq;\npq.push(x);\nint t = pq.top(); pq.pop();' },
  { language: 'cpp', name: 'deque', signature: 'deque<T> dq;', description: 'Double-ended queue: push_back/push_front/pop_back/pop_front O(1).', usecase: 'Sliding window maximum.', example: 'deque<int> dq;\ndq.push_back(i);\ndq.pop_front();' },
  { language: 'cpp', name: 'map', signature: 'map<K,V> m;', description: 'Ordered map (balanced tree), O(log n) ops, keys sorted.', usecase: 'Frequency/order-dependent counting.', example: 'map<int,int> m;\nm[x]++;' },
  { language: 'cpp', name: 'set', signature: 'set<T> s;', description: 'Ordered unique set, O(log n) insert/find.', usecase: 'Dedup with ordering.', example: 'set<int> s;\ns.insert(x);\nif(s.count(x)) ...' },
  { language: 'cpp', name: 'unordered_set', signature: 'unordered_set<T> s;', description: 'Hash set, average O(1) insert/find; iteration order unspecified.', usecase: 'Longest consecutive sequence, dedup.', example: 'unordered_set<int> s(nums.begin(), nums.end());\nif(s.count(x)) ...' },
  { language: 'cpp', name: 'multiset', signature: 'multiset<T> ms;', description: 'Ordered set allowing duplicates.', usecase: 'Sliding window with duplicates.', example: 'multiset<int> ms;\nms.insert(x);\nms.erase(ms.find(x));' },
  { language: 'cpp', name: 'pair', signature: 'pair<A,B> p;', description: 'Holds two values; p.first, p.second.', usecase: 'Return indices/values together.', example: 'pair<int,int> p = {i, j};\nreturn {m[c], i};' },
  // C++ member methods
  { language: 'cpp', name: 'insert', signature: 'm.insert(x) / s.insert(x)', description: 'Inserts into map/set; no-op if key exists (map). Returns iterator+bool for set/map.', usecase: 'Building lookup structures.', example: 's.insert(num);' },
  { language: 'cpp', name: 'erase', signature: 'm.erase(key) / v.erase(it)', description: 'Removes key from map/set (returns count) or element at iterator from vector.', usecase: 'Sliding window removals.', example: 's.erase(x);' },
  { language: 'cpp', name: 'find', signature: 'auto it = m.find(key)', description: 'Returns iterator to key or m.end() if absent. Prefer count() for plain existence checks.', usecase: 'Safe lookup before access.', example: 'auto it = m.find(c);\nif(it != m.end()) return it->second;' },
  { language: 'cpp', name: 'empty', signature: 'bool c.empty() const', description: 'True if container has no elements. Prefer over size()==0.', usecase: 'Stack/queue guards.', example: 'while(!st.empty()){ st.pop(); }' },
  { language: 'cpp', name: 'clear', signature: 'void c.clear()', description: 'Removes all elements.', usecase: 'Reset between test cases.', example: 'm.clear();' },
  { language: 'cpp', name: 'pop_back', signature: 'void vector<T>::pop_back()', description: 'Removes last element, O(1). Does not return it — read back() first.', usecase: 'Backtracking.', example: 'ans.pop_back();' },
  { language: 'cpp', name: 'back', signature: 'T& vector<T>::back()', description: 'Reference to last element.', usecase: 'Peek before pop.', example: 'int x = v.back();' },
  { language: 'cpp', name: 'front', signature: 'T& c.front()', description: 'Reference to first element.', usecase: 'Queue peek.', example: 'int x = q.front();' },
  { language: 'cpp', name: 'top', signature: 'T& stack<T>::top()', description: 'Reference to top element. Call pop() separately to remove.', usecase: 'Parentheses matching.', example: 'if(st.top() == c) st.pop();' },
  { language: 'cpp', name: 'push', signature: 'void stack<T>::push(x) / queue<T>::push(x)', description: 'Pushes onto stack/queue.', usecase: 'DFS/BFS, parentheses.', example: 'st.push(c);' },
  { language: 'cpp', name: 'pop', signature: 'void stack<T>::pop()', description: 'Removes top (returns void — read top() first).', usecase: 'Parentheses matching.', example: 'st.pop();' },
  { language: 'cpp', name: 'emplace', signature: 'm.emplace(k, v)', description: 'Constructs element in place, avoids temporary.', usecase: 'Map insertion in hot loops.', example: 'm.emplace(nums[i], i);' },
  { language: 'cpp', name: 'substr', signature: 'string s.substr(pos, len)', description: 'Returns substring copy, O(len).', usecase: 'Sliding window strings.', example: 's.substr(l, len)' },
  { language: 'cpp', name: 'begin', signature: 'c.begin() / nums.begin()', description: 'Iterator to first element; pair with .end() for ranges.', usecase: 'Construct set from vector, sort ranges.', example: 'unordered_set<int> s(nums.begin(), nums.end());' },
  { language: 'cpp', name: 'end', signature: 'c.end()', description: 'Past-the-end iterator; compare find() results against it.', usecase: 'Existence checks via find.', example: 'if(m.find(k) != m.end()) ...' },
  // C++ algorithms / functions
  { language: 'cpp', name: 'max', signature: 'max(a, b)', description: 'Returns larger of two values (needs <algorithm>, covered by bits).', usecase: 'Track best answer (maxCount, Kadane).', example: 'maxCount = max(maxCount, currCount);' },
  { language: 'cpp', name: 'min', signature: 'min(a, b)', description: 'Returns smaller of two values.', usecase: 'Track minimums.', example: 'ans = min(ans, x);' },
  { language: 'cpp', name: 'abs', signature: 'abs(x)', description: 'Absolute value.', usecase: 'Distance computations.', example: 'abs(a - b)' },
  { language: 'cpp', name: 'swap', signature: 'swap(a, b)', description: 'Exchanges two values.', usecase: 'In-place reverse/partition.', example: 'swap(nums[i], nums[j]);' },
  { language: 'cpp', name: 'accumulate', signature: 'accumulate(first, last, init)', description: 'Sums range starting from init, O(n).', usecase: 'Array sums.', example: 'int s = accumulate(nums.begin(), nums.end(), 0);' },
  { language: 'cpp', name: 'fill', signature: 'fill(first, last, val)', description: 'Assigns val to range.', usecase: 'Initialize arrays.', example: 'fill(ans.begin(), ans.end(), -1);' },
  { language: 'cpp', name: 'lower_bound', signature: 'lower_bound(first, last, x)', description: 'First iterator with value >= x (sorted range), O(log n).', usecase: 'Binary search insert position.', example: 'auto it = lower_bound(v.begin(), v.end(), x);' },
  { language: 'cpp', name: 'upper_bound', signature: 'upper_bound(first, last, x)', description: 'First iterator with value > x (sorted range), O(log n).', usecase: 'Count occurrences via bounds difference.', example: 'auto it = upper_bound(v.begin(), v.end(), x);' },
  { language: 'cpp', name: 'binary_search', signature: 'binary_search(first, last, x)', description: 'True if x in sorted range, O(log n).', usecase: 'Existence in sorted array.', example: 'if(binary_search(v.begin(), v.end(), x)) ...' },
  { language: 'cpp', name: 'min_element', signature: 'min_element(first, last)', description: 'Iterator to smallest element, O(n).', usecase: 'Find minimum without sorting.', example: 'auto it = min_element(v.begin(), v.end());' },
  { language: 'cpp', name: 'max_element', signature: 'max_element(first, last)', description: 'Iterator to largest element, O(n).', usecase: 'Find maximum without sorting.', example: 'auto it = max_element(v.begin(), v.end());' },
  // JS methods
  { language: 'javascript', name: 'pop', signature: 'arr.pop()', description: 'Removes and returns last element.', usecase: 'Stack via array.', example: 'const x = st.pop();' },
  { language: 'javascript', name: 'shift', signature: 'arr.shift()', description: 'Removes and returns first element (O(n)).', usecase: 'Queue via array (small n).', example: 'const x = q.shift();' },
  { language: 'javascript', name: 'unshift', signature: 'arr.unshift(x)', description: 'Prepends x (O(n)).', usecase: 'Build reversed output.', example: 'ans.unshift(x);' },
  { language: 'javascript', name: 'slice', signature: 'arr.slice(start, end?)', description: 'Returns shallow copy of portion; does not mutate.', usecase: 'Copy subarrays.', example: 'nums.slice(l, r)' },
  { language: 'javascript', name: 'splice', signature: 'arr.splice(start, count, ...items)', description: 'Mutates array: removes/replaces/inserts in place.', usecase: 'In-place removals.', example: 'nums.splice(i, 1);' },
  { language: 'javascript', name: 'sort', signature: 'arr.sort((a,b) => a-b)', description: 'Sorts in place; DEFAULT is lexicographic — always pass a comparator for numbers!', usecase: 'Sorting nums.', example: 'nums.sort((a,b) => a-b);' },
  { language: 'javascript', name: 'reverse', signature: 'arr.reverse()', description: 'Reverses in place and returns the array.', usecase: 'Reverse problems.', example: 's.reverse();' },
  { language: 'javascript', name: 'includes', signature: 'arr.includes(x)', description: 'True if x present (uses SameValueZero).', usecase: 'Membership checks.', example: 'if(seen.includes(x)) ...' },
  { language: 'javascript', name: 'indexOf', signature: 'arr.indexOf(x)', description: 'First index of x or -1.', usecase: 'Locate elements.', example: 'const i = nums.indexOf(t);' },
  { language: 'javascript', name: 'join', signature: 'arr.join(sep)', description: 'Joins elements into string.', usecase: 'Char array to string.', example: "s.join('')" },
  { language: 'javascript', name: 'fill', signature: 'arr.fill(v)', description: 'Fills all elements with v (mutates).', usecase: 'Initialize arrays.', example: 'new Array(n).fill(0)' },
  { language: 'javascript', name: 'reduce', signature: 'arr.reduce((acc,x) => ..., init)', description: 'Folds array to single value.', usecase: 'Sums, products.', example: 'nums.reduce((a,x) => a+x, 0)' },
  { language: 'javascript', name: 'some', signature: 'arr.some(fn)', description: 'True if any element passes.', usecase: 'Existence checks.', example: 'nums.some(x => x < 0)' },
  { language: 'javascript', name: 'every', signature: 'arr.every(fn)', description: 'True if all elements pass.', usecase: 'Validation.', example: 'nums.every(x => x > 0)' },
  { language: 'javascript', name: 'find', signature: 'arr.find(fn)', description: 'First element passing predicate (or undefined).', usecase: 'Search with condition.', example: 'nums.find(x => x > t)' },
  { language: 'javascript', name: 'Set', signature: 'new Set(iter?)', description: 'Unique-value collection with has/add/delete.', usecase: 'Dedup, longest consecutive.', example: 'const s = new Set(nums);\nif(s.has(x)) ...' },
  { language: 'javascript', name: 'has', signature: 'map.has(k) / set.has(v)', description: 'Existence check, O(1).', usecase: 'Complement lookup.', example: 'if(m.has(c)) return [m.get(c), i];' },
  { language: 'javascript', name: 'get', signature: 'map.get(k)', description: 'Returns value for key (or undefined).', usecase: 'Two-sum index retrieval.', example: 'return [m.get(c), i];' },
  { language: 'javascript', name: 'set', signature: 'map.set(k, v)', description: 'Stores key-value pair.', usecase: 'Build lookup map.', example: 'm.set(nums[i], i);' },
  { language: 'javascript', name: 'max', signature: 'Math.max(...arr)', description: 'Largest value; spread array first.', usecase: 'Best answer tracking.', example: 'Math.max(...nums)' },
  { language: 'javascript', name: 'min', signature: 'Math.min(...arr)', description: 'Smallest value; spread array first.', usecase: 'Minimum tracking.', example: 'Math.min(...nums)' },
  { language: 'javascript', name: 'split', signature: 'str.split(sep)', description: 'Splits string into array.', usecase: 'Parse inputs.', example: "s.split('')" },
  { language: 'javascript', name: 'keys', signature: 'Object.keys(obj)', description: 'Array of own enumerable keys.', usecase: 'Iterate frequency maps.', example: 'Object.keys(freq)' },
  // Python methods
  { language: 'python', name: 'pop', signature: 'list.pop([i])', description: 'Removes and returns item (last by default).', usecase: 'Stack via list.', example: 'x = st.pop()' },
  { language: 'python', name: 'sort', signature: 'list.sort()', description: 'Sorts in place, returns None (unlike sorted).', usecase: 'In-place sort.', example: 'nums.sort()' },
  { language: 'python', name: 'sorted', signature: 'sorted(iter)', description: 'Returns new sorted list, original untouched.', usecase: 'Sorted copy.', example: 'for x in sorted(nums):' },
  { language: 'python', name: 'reversed', signature: 'reversed(seq)', description: 'Reverse iterator.', usecase: 'Reverse traversal.', example: 'for x in reversed(nums):' },
  { language: 'python', name: 'set', signature: 'set(iter?)', description: 'Unordered unique collection.', usecase: 'Dedup, consecutive sequence.', example: 's = set(nums)\nif x in s: ...' },
  { language: 'python', name: 'add', signature: 'set.add(x)', description: 'Adds element to set.', usecase: 'Build lookup set.', example: 'seen.add(n)' },
  { language: 'python', name: 'remove', signature: 'set.remove(x) / list.remove(x)', description: 'Removes x; raises KeyError/ValueError if absent (use discard/pop guard).', usecase: 'Sliding window.', example: 's.remove(x)' },
  { language: 'python', name: 'discard', signature: 'set.discard(x)', description: 'Removes x if present; no error otherwise.', usecase: 'Safe removal.', example: 's.discard(x)' },
  { language: 'python', name: 'split', signature: 'str.split(sep?)', description: 'Splits string into list.', usecase: 'Parsing.', example: "s.split(' ')" },
  { language: 'python', name: 'join', signature: 'sep.join(list)', description: 'Joins strings with separator.', usecase: 'Char list to string.', example: "''.join(s)" },
  { language: 'python', name: 'zip', signature: 'zip(a, b)', description: 'Pairs elements from iterables.', usecase: 'Parallel iteration.', example: 'for a, b in zip(A, B):' },
  { language: 'python', name: 'max', signature: 'max(iter)', description: 'Largest item.', usecase: 'Best tracking.', example: 'best = max(best, cur)' },
  { language: 'python', name: 'min', signature: 'min(iter)', description: 'Smallest item.', usecase: 'Minimum tracking.', example: 'ans = min(ans, x)' },
  { language: 'python', name: 'abs', signature: 'abs(x)', description: 'Absolute value.', usecase: 'Distances.', example: 'abs(a - b)' },
  { language: 'python', name: 'sum', signature: 'sum(iter)', description: 'Sums items.', usecase: 'Array sums.', example: 'sum(nums)' },
  { language: 'python', name: 'defaultdict', signature: 'defaultdict(factory)', description: 'Dict with default values for missing keys (from collections).', usecase: 'Frequency maps without checks.', example: 'from collections import defaultdict\nm = defaultdict(int)\nm[x] += 1' },
  { language: 'python', name: 'Counter', signature: 'Counter(iter)', description: 'Frequency dict (from collections).', usecase: 'Count occurrences.', example: 'from collections import Counter\nc = Counter(nums)' },
  { language: 'python', name: 'heappush', signature: 'heappush(heap, x)', description: 'Pushes onto min-heap (from heapq).', usecase: 'Top-K problems.', example: 'import heapq\nheapq.heappush(h, x)' },
  { language: 'python', name: 'heappop', signature: 'heappop(heap)', description: 'Pops smallest from min-heap (from heapq).', usecase: 'Top-K problems.', example: 'x = heapq.heappop(h)' },
  { language: 'python', name: 'items', signature: 'dict.items()', description: 'Yields (key, value) pairs.', usecase: 'Iterate maps.', example: 'for k, v in m.items():' },
  { language: 'python', name: 'get', signature: 'dict.get(k, default?)', description: 'Value for key or default (no KeyError).', usecase: 'Safe lookup.', example: 'm.get(k, 0)' },
  { language: 'python', name: 'update', signature: 'dict.update(other)', description: 'Merges mappings.', usecase: 'Combine counts.', example: 'm.update(other)' },
  { language: 'python', name: 'setdefault', signature: 'dict.setdefault(k, default)', description: 'Returns value; inserts default if missing.', usecase: 'Group-by patterns.', example: "m.setdefault(k, []).append(x)" },
  { language: 'python', name: 'strip', signature: 'str.strip()', description: 'Trims surrounding whitespace.', usecase: 'Input cleanup.', example: 's.strip()' },
  { language: 'python', name: 'ord', signature: 'ord(ch)', description: 'Unicode code point of character.', usecase: 'Char arithmetic.', example: 'ord(c) - ord("a")' },
  { language: 'python', name: 'chr', signature: 'chr(n)', description: 'Character for code point.', usecase: 'Build chars.', example: 'chr(97)' },
];

async function seedMethodDocs() {
  const pool = getPool();
  for (const m of SEED) {
    try {
      await pool.query(
        `INSERT INTO method_docs (language, name, signature, description, usecase, example) VALUES (?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE signature=VALUES(signature), description=VALUES(description), usecase=VALUES(usecase), example=VALUES(example)`,
        [m.language, m.name, m.signature || null, m.description, m.usecase || null, m.example || null]
      );
    } catch {}
  }
}

async function searchMethods(language, q, limit = 10) {
  const pool = getPool();
  const like = `%${q}%`;
  const [rows] = await pool.query(
    `SELECT language, name, signature, description, usecase, example FROM method_docs
     WHERE language=? AND (name LIKE ? OR description LIKE ?) ORDER BY name LIMIT ?`,
    [language, like, like, Math.min(limit, 200)]
  );
  return rows;
}

async function getMethodDoc(language, name) {
  const pool = getPool();
  // BINARY first so `Map` doesn't resolve to `map` (collation is case-insensitive)
  const [exact] = await pool.query(
    `SELECT language, name, signature, description, usecase, example FROM method_docs WHERE language=? AND BINARY name=? LIMIT 1`,
    [language, name]
  );
  if (exact.length) return exact[0];
  const [rows] = await pool.query(
    `SELECT language, name, signature, description, usecase, example FROM method_docs WHERE language=? AND name=? LIMIT 1`,
    [language, name]
  );
  return rows[0] || null;
}

module.exports = { seedMethodDocs, searchMethods, getMethodDoc };
