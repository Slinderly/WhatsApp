const path = require('path');
const fs   = require('fs');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR   = path.join(__dirname, '../data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const load = () => {
    try { return JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); }
    catch { return []; }
};

const save = (tasks) => fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));

const addTask = (text, priority = 'normal') => {
    const tasks = load();
    const task = {
        id:        uuidv4().slice(0, 8),
        text:      text.trim(),
        priority,
        done:      false,
        createdAt: new Date().toISOString(),
        doneAt:    null,
    };
    tasks.push(task);
    save(tasks);
    return task;
};

const getTasks = (filter = 'all') => {
    const tasks = load();
    if (filter === 'pending') return tasks.filter(t => !t.done);
    if (filter === 'done')    return tasks.filter(t => t.done);
    return tasks;
};

const completeTask = (idOrIndex) => {
    const tasks = load();
    let task;
    if (typeof idOrIndex === 'number') {
        const pending = tasks.filter(t => !t.done);
        task = pending[idOrIndex - 1];
        if (task) task = tasks.find(t => t.id === task.id);
    } else {
        task = tasks.find(t => t.id === idOrIndex || t.text.toLowerCase().includes(idOrIndex.toLowerCase()));
    }
    if (!task) return null;
    task.done  = true;
    task.doneAt = new Date().toISOString();
    save(tasks);
    return task;
};

const deleteTask = (idOrIndex) => {
    let tasks = load();
    let target;
    if (typeof idOrIndex === 'number') {
        const all = tasks;
        target = all[idOrIndex - 1];
    } else {
        target = tasks.find(t => t.id === idOrIndex || t.text.toLowerCase().includes(idOrIndex.toLowerCase()));
    }
    if (!target) return null;
    tasks = tasks.filter(t => t.id !== target.id);
    save(tasks);
    return target;
};

const clearDone = () => {
    const tasks = load().filter(t => !t.done);
    save(tasks);
    return tasks.length;
};

const clearAll = () => {
    save([]);
};

const formatTaskList = (filter = 'all') => {
    const tasks = getTasks(filter);
    if (tasks.length === 0) {
        if (filter === 'pending') return 'No tienes tareas pendientes 🎉';
        if (filter === 'done')    return 'Aún no has completado ninguna tarea.';
        return 'No tienes tareas todavía.';
    }
    const lines = tasks.map((t, i) => {
        const check = t.done ? '✅' : '⬜';
        const prio  = t.priority === 'alta' ? ' 🔴' : t.priority === 'media' ? ' 🟡' : '';
        return `${check} ${i + 1}. ${t.text}${prio}`;
    });
    const pending = tasks.filter(t => !t.done).length;
    const done    = tasks.filter(t => t.done).length;
    return lines.join('\n') + `\n\n📊 ${pending} pendientes · ${done} completadas`;
};

module.exports = { addTask, getTasks, completeTask, deleteTask, clearDone, clearAll, formatTaskList };
