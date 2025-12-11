import pandas as pd
from rapidfuzz import process, fuzz
from metaphone import doublemetaphone
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from typing import Optional, Literal
import uvicorn
import os
import re

app = FastAPI()

# --- 1. CONFIGURATION ---
SOUND_MAP = {
    'k': 'c', 'c': 'k', 'f': 'p', 'p': 'f', 
    'z': 's', 's': 'z', 'j': 'g', 'g': 'j',
    'i': 'e', 'e': 'i', 'v': 'w', 'w': 'v'
}

# --- 2. CLEANING UTILS ---
def clean_brand_name(text):
    """Standard cleaning for Brands (Removes Tab, Cap, MR, etc.)"""
    if not isinstance(text, str): return ""
    text = text.lower().strip()
    # Remove Prefixes
    text = re.sub(r'^(tab|cap|inj|syr|tablet|capsule|injection|syrup|gel|cream|oint|drops)\.?\s+', '', text)
    # Remove Suffixes
    noise_words = ['tablet', 'capsule', 'injection', 'syrup', 'suspension', 'solution', 'drops', 'cream', 'gel', 'ointment', 'liquid']
    text = re.sub(r'\b(' + '|'.join(noise_words) + r')\b', '', text)
    # Remove Variants & Numbers
    text = re.sub(r'\b(mr|sr|ds|ls|plus|forte|xl|xr|duo)\b', '', text)
    text = re.sub(r'\b[a-z]\b', '', text) # Single letters
    text = re.sub(r'\d+w?v?/?\s?([a-z]+)?', '', text) # Dosages
    return re.sub(r'\s+', ' ', text).strip()

def clean_composition_name(text):
    """
    Cleaning for Molecules.
    "Paracetamol 500mg + Caffeine" -> "paracetamol caffeine"
    This helps us find the 'First Letter' for partitioning.
    """
    if not isinstance(text, str): return ""
    text = text.lower().strip()
    # Remove dosages (500mg, 10ml, 2%)
    text = re.sub(r'\d+(\.\d+)?\s*(mg|ml|g|%|mcg|iu)', '', text)
    # Remove isolated numbers
    text = re.sub(r'\b\d+\b', '', text)
    # Remove special chars
    text = re.sub(r'[+\-,/()]', ' ', text)
    return re.sub(r'\s+', ' ', text).strip()

# --- 3. ENGINE LOGIC ---
class MedicineEngine:
    def __init__(self, csv_filename):
        print(f"🚀 Initializing Engine with {csv_filename}...")
        
        if not os.path.exists(csv_filename):
            raise FileNotFoundError(f"File {csv_filename} not found")

        # AUTO-DETECT COLUMNS
        df_preview = pd.read_csv(csv_filename, nrows=1)
        cols = list(df_preview.columns)
        
        def find_col(candidates):
            for c in cols:
                if c.lower() in candidates: return c
            return None

        id_col = find_col(['id', 'uid', 'identifier'])
        name_col = find_col(['name', 'drug_name', 'brand_name'])
        mfr_col = find_col(['manufacturer_name', 'manufacturer', 'manufacture'])
        comp1_col = find_col(['short_composition1', 'composition1', 'generic1'])
        comp2_col = find_col(['short_composition2', 'composition2', 'generic2'])

        if not name_col: raise ValueError("Could not find a Name column!")

        # LOAD DATA
        self.df = pd.read_csv(csv_filename)
        
        # NORMALIZE COLUMNS
        if id_col: self.df['record_id'] = self.df[id_col]
        else: self.df['record_id'] = self.df.index

        self.df['display_name'] = self.df[name_col].astype(str).str.strip()
        self.df['clean_brand'] = self.df['display_name'].apply(clean_brand_name)
        self.df['phonetic_code'] = self.df['clean_brand'].apply(lambda x: doublemetaphone(x)[0])

        if mfr_col: self.df['manufacturer'] = self.df[mfr_col].fillna('Unknown')
        else: self.df['manufacturer'] = 'Unknown'

        # COMPOSITION LOGIC
        comp1 = self.df[comp1_col].fillna('') if comp1_col else pd.Series([''] * len(self.df))
        comp2 = self.df[comp2_col].fillna('') if comp2_col else pd.Series([''] * len(self.df))
        self.df['primary_molecule_1'] = comp1.astype(str).str.strip()
        self.df['primary_molecule_2'] = comp2.astype(str).str.strip()

        self.df['composition_display'] = (self.df['primary_molecule_1'] + " " + self.df['primary_molecule_2']).str.strip()
        self.df['full_composition'] = self.df['composition_display'].str.lower()
        # Create a clean version for molecule searching (remove dosages)
        self.df['clean_composition'] = self.df['full_composition'].apply(clean_composition_name)
        # Target used for typeahead to leverage both brand and molecule text
        self.df['suggest_target'] = (self.df['clean_brand'] + " " + self.df['clean_composition']).str.strip()

        # --- PARTITIONING (Create 2 Indices) ---
        
        # 1. Brand Index (Group by Brand Name)
        self.df['brand_char'] = self.df['clean_brand'].str[0].fillna('')
        self.brand_partitions = {k: v for k, v in self.df.groupby('brand_char')}
        
        # 2. Molecule Index (Group by Molecule Name)
        # "Paracetamol" -> 'p' partition
        self.df['mol_char'] = self.df['clean_composition'].str[0].fillna('')
        self.mol_partitions = {k: v for k, v in self.df.groupby('mol_char')}
        
        print(f"✅ Loaded {len(self.df)} rows. Indices built.")

    def search(self, query: str, search_type: str = "brand"):
        if not query: return []
        
        # --- MODE 1: BRAND SEARCH ---
        if search_type == "brand":
            clean_q = clean_brand_name(query)
            if not clean_q: clean_q = query.lower()
            first_char = clean_q[0]
            
            # Sound Map Search (Neighboring Buckets)
            buckets = [first_char]
            if first_char in SOUND_MAP: buckets.append(SOUND_MAP[first_char])
            
            choices_df = pd.concat([self.brand_partitions.get(c, pd.DataFrame()) for c in buckets])
            if len(choices_df) < 50: choices_df = self.df # Fallback
            
            # Fuzzy match on BRAND NAME
            candidates = process.extract(
                clean_q, 
                choices_df['clean_brand'].tolist(), 
                scorer=fuzz.token_set_ratio, 
                limit=50
            )
            
            results = []
            q_phone = doublemetaphone(clean_q)[0]
            
            for clean_match, score, idx in candidates:
                row = choices_df.iloc[idx]
                final_score = score
                if row['phonetic_code'] == q_phone: final_score += 25
                
                results.append(self._format_result(row, final_score))

        # --- MODE 2: MOLECULE SEARCH ---
        else:
            clean_q = clean_composition_name(query)
            if not clean_q: clean_q = query.lower()
            first_char = clean_q[0]
            
            # Partition by Molecule Start Letter
            choices_df = self.mol_partitions.get(first_char, pd.DataFrame())
            if len(choices_df) < 50: choices_df = self.df # Fallback

            # Fuzzy match on COMPOSITION
            # We use partial_token_set_ratio because query "Paracetamol" is a subset of "Paracetamol + Caffeine"
            candidates = process.extract(
                clean_q,
                choices_df['clean_composition'].tolist(),
                scorer=fuzz.partial_token_set_ratio, 
                limit=100
            )

            results = []
            for clean_match, score, idx in candidates:
                row = choices_df.iloc[idx]
                # Slight boost if manufacturer matches query (optional, rare for molecules)
                results.append(self._format_result(row, score))

        # Deduplicate & Sort
        return self._deduplicate_and_sort(results)

    def _format_result(self, row, score):
        row_id = row.get('record_id', None)
        if pd.isna(row_id): row_id = None
        if row_id is not None:
            try:
                row_id = int(row_id)
            except Exception:
                row_id = None
        mol1 = row.get('primary_molecule_1', '') or ''
        mol2 = row.get('primary_molecule_2', '') or ''
        return {
            "brand": str(row['display_name']),
            "manufacturer": str(row['manufacturer']),
            "composition": str(row.get('composition_display', row['full_composition'])),
            "match_score": round(score, 0),
            "id": row_id,
            "mol1": mol1,
            "mol2": mol2
        }

    def _deduplicate_and_sort(self, results):
        unique = {}
        for r in results:
            key = r.get('id') if r.get('id') is not None else r['brand']
            if key not in unique: unique[key] = r
            else:
                if r['match_score'] > unique[key]['match_score']:
                    unique[key] = r
        final = list(unique.values())
        final.sort(key=lambda x: x['match_score'], reverse=True)
        return final[:20]

    def suggest(self, query: str, limit: int = 10):
        """Lightweight suggestor used by typeahead."""
        if not query: return []
        clean_q = clean_brand_name(query)
        if not clean_q: clean_q = query.lower().strip()
        first_char = clean_q[:1]

        buckets = [first_char] if first_char else []
        if first_char in SOUND_MAP: buckets.append(SOUND_MAP[first_char])

        partitions = [self.brand_partitions.get(c, pd.DataFrame()) for c in buckets] if buckets else []
        choices_df = pd.concat(partitions) if partitions else pd.DataFrame()
        if choices_df.empty or len(choices_df) < 50:
            choices_df = self.df

        candidates = process.extract(
            clean_q,
            choices_df['suggest_target'].tolist(),
            scorer=fuzz.partial_ratio,
            limit=limit * 3
        )

        results = []
        for _, score, idx in candidates:
            row = choices_df.iloc[idx]
            results.append(self._format_result(row, score))

        return self._deduplicate_and_sort(results)[:limit]

# --- 4. SERVER SETUP ---
csv_filename = "indian_medicine_data.csv"
try:
    engine = MedicineEngine(csv_filename)
except Exception as e:
    print(f"❌ ERROR: {e}")
    engine = None

class SearchPayload(BaseModel):
    query: str
    search_type: Literal["brand", "molecule"] = "brand"

@app.get("/", response_class=HTMLResponse)
async def serve_ui():
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Smart Medicine Search</title>
        <style>
            body { font-family: -apple-system, system-ui, sans-serif; max-width: 1000px; margin: 40px auto; padding: 20px; background:#f4f6f8; }
            .container { background: white; padding: 30px; border-radius: 12px; box-shadow: 0 2px 16px rgba(0,0,0,0.08); }
            h1 { margin-top: 0; }
            
            .toggle-container { display: flex; background: #eee; width: fit-content; border-radius: 20px; margin-bottom: 20px; padding: 4px; }
            .toggle-btn { padding: 10px 20px; border: none; background: transparent; cursor: pointer; border-radius: 16px; font-weight: 600; color: #666; transition: 0.3s; }
            .toggle-btn.active { background: #007bff; color: white; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            
            input { padding: 14px; width: 65%; border:1px solid #ddd; border-radius:8px; font-size:16px; outline:none; }
            input:focus { border-color: #007bff; }
            button.search-btn { padding: 14px 24px; background: #007bff; color: white; border: none; border-radius:8px; font-size:16px; cursor:pointer; font-weight:600; }
            
            table { width: 100%; margin-top: 20px; border-collapse: collapse; }
            th, td { padding: 14px; border-bottom: 1px solid #eee; text-align: left; vertical-align: top; }
            th { background:#f8f9fa; color:#555; font-size: 0.9em; text-transform: uppercase; letter-spacing: 0.5px; }
            .score { color: #28a745; font-weight: bold; text-align: center; }
            .drug-cell { display: flex; gap: 10px; align-items: center; cursor: pointer; }
            .drug-name { font-size: 1.05em; color: #1f2937; border-bottom: 1px dashed #cbd5e1; }
            .edit-hint { font-size: 0.85em; color: #0d6efd; opacity: 0; transition: 0.2s; }
            .editable:hover .edit-hint { opacity: 1; }
            .editable { position: relative; }
            .drug-composition { color: #666; margin-top: 6px; font-size: 0.92em; }
            .mol-col { color: #0d47a1; min-width: 150px; }
            .empty { color: #94a3b8; }
            
            .popover { position: absolute; top: calc(100% + 6px); left: 0; background: white; border:1px solid #e2e8f0; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border-radius: 10px; padding: 10px; z-index: 10; width: min(360px, 90vw); }
            .popover input { width: 100%; margin-bottom: 8px; box-sizing: border-box; }
            .suggestions { max-height: 240px; overflow-y: auto; border: 1px solid #e5e7eb; border-radius: 8px; }
            .suggestion { padding: 10px; border-bottom: 1px solid #f1f5f9; cursor: pointer; }
            .suggestion:last-child { border-bottom: none; }
            .suggestion:hover, .suggestion.active { background: #eef2ff; }
            .suggestion .name { font-weight: 600; color: #111827; }
            .suggestion .molecules { color: #475569; font-size: 0.9em; margin-top: 3px; }
            .suggestion .manufacturer { color: #6b7280; font-size: 0.85em; }
            .empty-state { padding: 10px; color: #6b7280; text-align: center; }
            .popover-foot { margin-top: 6px; font-size: 0.85em; color: #94a3b8; display: flex; justify-content: space-between; align-items: center; }
            .pill { padding: 4px 8px; background: #e0f2fe; color: #0369a1; border-radius: 12px; font-size: 0.85em; }
        </style>
    </head>
    <body>
        <div class="container">
            <h1>💊 Smart Search</h1>
            
            <div class="toggle-container">
                <button class="toggle-btn active" id="btn-brand" onclick="setMode('brand')">Brand Name</button>
                <button class="toggle-btn" id="btn-molecule" onclick="setMode('molecule')">Molecule / Composition</button>
            </div>

            <div style="display:flex; gap:10px;">
                <input type="text" id="q" placeholder="Search for 'Dolo'..." onkeypress="if(event.key==='Enter') search()">
                <button class="search-btn" onclick="search()">Search</button>
            </div>
            
            <table id="results">
                <thead><tr><th>Medicine</th><th>Molecule 1</th><th>Molecule 2</th><th>Manufacturer</th><th>Match</th></tr></thead>
                <tbody></tbody>
            </table>
        </div>
        <script>
            let currentMode = 'brand';
            let activePopover = null;
            const DEBOUNCE_MS = 180;

            function setMode(mode) {
                currentMode = mode;
                // Update UI buttons
                document.getElementById('btn-brand').className = mode === 'brand' ? 'toggle-btn active' : 'toggle-btn';
                document.getElementById('btn-molecule').className = mode === 'molecule' ? 'toggle-btn active' : 'toggle-btn';
                
                // Update placeholder text
                const input = document.getElementById('q');
                input.placeholder = mode === 'brand' ? "Search for 'Dolo', 'Augmentin'..." : "Search for 'Paracetamol', 'Azithromycin'...";
                input.focus();
            }

            async function search() {
                const q = document.getElementById('q').value.trim();
                const tbody = document.querySelector('#results tbody');
                
                if (!q) return;

                tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:#888;">Searching...</td></tr>';
                
                try {
                    const res = await fetch('/search', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({ query: q, search_type: currentMode })
                    });
                    const data = await res.json();
                    
                    tbody.innerHTML = '';
                    
                    if(data.length === 0) {
                        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">No matches found.</td></tr>';
                        return;
                    }

                    data.forEach(row => tbody.appendChild(renderRow(row)));
                } catch (e) {
                    alert("Error: " + e);
                }
            }

            function renderRow(row) {
                const tr = document.createElement('tr');
                const mol1 = row.mol1 || '';
                const mol2 = row.mol2 || '';

                const medCell = document.createElement('td');
                medCell.className = 'editable';
                medCell.dataset.rowId = row.id || '';
                medCell.innerHTML = `
                    <div class="drug-cell" tabindex="0">
                        <span class="drug-name">${row.brand}</span>
                        <span class="edit-hint">✏️ Edit</span>
                    </div>
                    <div class="drug-composition">${row.composition || ''}</div>
                `;

                const mol1Cell = document.createElement('td');
                mol1Cell.className = 'mol-col mol1';
                mol1Cell.textContent = mol1 || '—';

                const mol2Cell = document.createElement('td');
                mol2Cell.className = 'mol-col mol2';
                mol2Cell.textContent = mol2 || '—';

                const mfrCell = document.createElement('td');
                mfrCell.textContent = row.manufacturer;

                const scoreCell = document.createElement('td');
                scoreCell.className = 'score';
                scoreCell.textContent = row.match_score;

                tr.appendChild(medCell);
                tr.appendChild(mol1Cell);
                tr.appendChild(mol2Cell);
                tr.appendChild(mfrCell);
                tr.appendChild(scoreCell);

                attachEditable(medCell, { ...row, mol1, mol2 });
                return tr;
            }

            function attachEditable(cell, rowData) {
                const open = () => openPopover(cell, rowData);
                const trigger = cell.querySelector('.drug-cell');
                trigger.addEventListener('click', open);
                trigger.addEventListener('keypress', (e) => { if (e.key === 'Enter') open(); });
            }

            function debounce(fn, delay) {
                let timer;
                return (...args) => {
                    clearTimeout(timer);
                    timer = setTimeout(() => fn(...args), delay);
                };
            }

            const debouncedSuggest = debounce((value, listEl, state) => loadSuggestions(value, listEl, state), DEBOUNCE_MS);

            function closePopover() {
                if (activePopover && activePopover.parentElement) {
                    activePopover.parentElement.removeChild(activePopover);
                }
                activePopover = null;
            }

            function openPopover(cell, rowData) {
                closePopover();
                const pop = document.createElement('div');
                pop.className = 'popover';
                pop.innerHTML = `
                    <input type="text" aria-label="Edit medicine name" value="${rowData.brand || ''}">
                    <div class="suggestions"><div class="empty-state">Start typing to see matches</div></div>
                    <div class="popover-foot">
                        <span class="pill">Typeahead</span>
                        <span>Esc to close • Enter to select</span>
                    </div>
                `;
                cell.appendChild(pop);
                activePopover = pop;

                const input = pop.querySelector('input');
                const listEl = pop.querySelector('.suggestions');
                const state = { highlight: -1, lastResults: [], cell, rowData };

                input.addEventListener('input', (e) => {
                    debouncedSuggest(e.target.value, listEl, state);
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Escape') { closePopover(); return; }
                    if (e.key === 'ArrowDown') { moveHighlight(1, listEl, state); e.preventDefault(); }
                    if (e.key === 'ArrowUp') { moveHighlight(-1, listEl, state); e.preventDefault(); }
                    if (e.key === 'Enter') { 
                        if (state.highlight >= 0 && state.lastResults[state.highlight]) {
                            applySuggestion(cell, rowData, state.lastResults[state.highlight]);
                        } else {
                            validateAndApply(input.value, cell, rowData);
                        }
                        e.preventDefault();
                    }
                });

                debouncedSuggest(input.value, listEl, state);
                input.focus();
            }

            async function loadSuggestions(value, listEl, state) {
                const q = value.trim();
                if (!q) {
                    listEl.innerHTML = '<div class="empty-state">Start typing to see matches</div>';
                    state.lastResults = [];
                    state.highlight = -1;
                    return;
                }
                listEl.innerHTML = '<div class="empty-state">Searching…</div>';
                try {
                    const res = await fetch(`/medicine-suggest?q=${encodeURIComponent(q)}`);
                    const data = await res.json();
                    state.lastResults = data || [];
                    renderSuggestions(listEl, state);
                } catch (err) {
                    listEl.innerHTML = '<div class="empty-state">Could not fetch suggestions</div>';
                    state.lastResults = [];
                }
            }

            function renderSuggestions(listEl, state) {
                const results = state.lastResults;
                if (!results.length) {
                    listEl.innerHTML = '<div class="empty-state">No results</div>';
                    state.highlight = -1;
                    return;
                }
                listEl.innerHTML = '';
                results.forEach((sugg, idx) => {
                    const item = document.createElement('div');
                    item.className = 'suggestion';
                    if (idx === state.highlight) item.classList.add('active');
                    item.innerHTML = `
                        <div class="name">${sugg.brand}</div>
                        <div class="molecules">${[sugg.mol1, sugg.mol2].filter(Boolean).join(' • ') || 'No molecule info'}</div>
                        <div class="manufacturer">${sugg.manufacturer || ''}</div>
                    `;
                    item.addEventListener('mouseenter', () => { state.highlight = idx; syncHighlight(listEl, state); });
                    item.addEventListener('click', () => applySuggestion(state.cell, state.rowData, sugg));
                    listEl.appendChild(item);
                });
                state.highlight = 0;
                syncHighlight(listEl, state);
            }

            function syncHighlight(listEl, state) {
                [...listEl.children].forEach((el, i) => {
                    el.classList.toggle('active', i === state.highlight);
                });
            }

            function moveHighlight(delta, listEl, state) {
                if (!state.lastResults.length) return;
                state.highlight = (state.highlight + delta + state.lastResults.length) % state.lastResults.length;
                syncHighlight(listEl, state);
            }

            function applySuggestion(cell, rowData, suggestion) {
                rowData.brand = suggestion.brand;
                rowData.mol1 = suggestion.mol1 || '';
                rowData.mol2 = suggestion.mol2 || '';
                rowData.id = suggestion.id;
                rowData.composition = suggestion.composition || rowData.composition;

                cell.dataset.rowId = rowData.id || '';
                cell.querySelector('.drug-name').textContent = rowData.brand;
                cell.querySelector('.drug-composition').textContent = rowData.composition || '';

                const rowEl = cell.closest('tr');
                rowEl.querySelector('.mol1').textContent = rowData.mol1 || '—';
                rowEl.querySelector('.mol2').textContent = rowData.mol2 || '—';

                closePopover();
            }

            async function validateAndApply(value, cell, rowData) {
                const q = value.trim();
                if (!q) return;
                try {
                    const res = await fetch(`/medicine-validate?q=${encodeURIComponent(q)}`);
                    const data = await res.json();
                    if (data && data.brand) {
                        applySuggestion(cell, rowData, data);
                    } else {
                        closePopover();
                    }
                } catch (err) {
                    closePopover();
                }
            }

            document.addEventListener('click', (e) => {
                if (activePopover && !activePopover.contains(e.target) && !e.target.closest('.editable')) {
                    closePopover();
                }
            });
        </script>
    </body>
    </html>
    """

@app.post("/search")
async def search_api(payload: SearchPayload):
    if not engine: return []
    return engine.search(payload.query, payload.search_type)

@app.get("/medicine-suggest")
async def medicine_suggest(q: Optional[str] = None):
    if not engine or not q: return []
    return engine.suggest(q)

@app.get("/medicine-validate")
async def medicine_validate(q: Optional[str] = None):
    if not engine or not q: return {}
    suggestions = engine.suggest(q, limit=1)
    return suggestions[0] if suggestions else {}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8000)
