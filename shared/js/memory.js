// MAOMAO memory core — keep legacy storage compatible; never fabricate daily events.
const memorySystem = {
    data: { memories: [], mood: "", dailyEvent: "", lastUpdate: "" },

    init() {
        let saved = null;
        try { saved = JSON.parse(localStorage.getItem('phone_memory_data')); } catch (e) {}
        if (saved && typeof saved === 'object') this.data = { ...this.data, ...saved };
        this.dailyRefresh();
        this.renderMemoryPage();
    },

    // Clear synthetic daily prompts but preserve old memory entries for compatibility.
    dailyRefresh() {
        this.data.lastUpdate = new Date().toDateString();
        this.data.mood = "";
        this.data.dailyEvent = "";
        this.save();
    },

    // Legacy preview only. The actual full conversation is preserved in chat_history_<roleId>.
    addMemory(text) {
        if (!text || !String(text).trim()) return;
        this.data.memories.unshift({
            id: Date.now(), date: new Date().toDateString(),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            content: String(text).trim(), source: 'legacy'
        });
        if (this.data.memories.length > 60) this.data.memories.length = 60;
        this.save();
        this.renderMemoryPage();
    },

    deleteMemory(id) {
        this.data.memories = this.data.memories.filter(m => String(m.id) !== String(id));
        this.save();
        this.renderMemoryPage();
    },

    save() {
        try { localStorage.setItem('phone_memory_data', JSON.stringify(this.data)); } catch (e) {}
    },

    escapeHtml(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c];
        });
    },

    renderMemoryPage() {
        const moodEl = document.getElementById('mem-daily-mood');
        const eventEl = document.getElementById('mem-daily-event');
        const listEl = document.getElementById('mem-list');
        if (moodEl) moodEl.innerText = "";
        if (eventEl) eventEl.innerText = "";
        if (!listEl) return;
        if (!this.data.memories.length) {
            listEl.innerHTML = '<div class="mem-empty">完整聊天记录保存在各角色自己的历史中。</div>';
            return;
        }
        const groups = {};
        this.data.memories.forEach(m => {
            const d = m.date || (m.id ? new Date(m.id).toDateString() : '未知');
            if (!groups[d]) groups[d] = [];
            groups[d].push(m);
        });
        const dates = Object.keys(groups).sort((a,b) => new Date(b) - new Date(a));
        const today = new Date().toDateString();
        const yesterday = new Date(Date.now() - 86400000).toDateString();
        listEl.innerHTML = dates.map(date => {
            const items = groups[date];
            const label = date === today ? '今天' : (date === yesterday ? '昨天' : (function () {
                const d = new Date(date); return (d.getMonth()+1) + '月' + d.getDate() + '日';
            })());
            const visible = items.slice(0,3), more = items.length - 3;
            return '<div class="mem-group"><div class="mem-group-head"><span class="mem-group-date">' +
                this.escapeHtml(label) + '</span><span class="mem-group-count">' + items.length + ' 条</span></div>' +
                visible.map(m => this.memLineHTML(m)).join('') +
                (more > 0 ? '<div class="mem-group-more" onclick="memorySystem.toggleGroupRest(this)">展开其余 ' + more +
                    ' 条</div><div class="mem-group-rest" style="display:none;">' + items.slice(3).map(m => this.memLineHTML(m)).join('') + '</div>' : '') +
                '</div>';
        }).join('');
        this.bindLineDelete();
    },

    memLineHTML(m) {
        return '<div class="mem-line"><span class="mem-line-time">' + this.escapeHtml(m.time) +
            '</span><span class="mem-line-content">' + this.escapeHtml(m.content) +
            '</span><button class="mem-line-del" data-id="' + this.escapeHtml(m.id) + '" aria-label="删除">×</button></div>';
    },

    bindLineDelete() {
        const listEl = document.getElementById('mem-list');
        if (!listEl) return;
        listEl.querySelectorAll('.mem-line-del').forEach(btn => {
            btn.onclick = function (e) {
                e.stopPropagation();
                const id = this.getAttribute('data-id');
                if (confirm('删除这条旧版记忆副本？不会删除原始聊天记录。')) memorySystem.deleteMemory(id);
            };
        });
    },

    toggleGroupRest(el) {
        const rest = el.nextElementSibling;
        if (!rest) return;
        if (rest.style.display === 'none') {
            rest.style.display = 'block'; el.textContent = '收起';
        } else {
            rest.style.display = 'none'; el.textContent = '展开其余 ' + rest.children.length + ' 条';
        }
    },

    getAIContext() {
        return '只依据真实保存的聊天记录和已确认记忆判断共同经历；不要把未发生或没有证据的事情当成真实回忆。';
    }
};
document.addEventListener('DOMContentLoaded', () => memorySystem.init());
