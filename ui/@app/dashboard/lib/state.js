export const STORAGE_KEY = 'ms-tasks-clone-v1';

export const BASE_LISTS = [
  { id: 'inbox', name: 'Tasks', kind: 'regular', locked: true },
  { id: 'my-day', name: 'My Day', kind: 'smart', locked: true },
  { id: 'important', name: 'Important', kind: 'smart', locked: true },
  { id: 'planned', name: 'Planned', kind: 'smart', locked: true },
  { id: 'completed', name: 'Completed', kind: 'smart', locked: true }
];

const STARTER_TASKS = [
  {
    id: 't-1',
    title: 'Plan weekly sprint goals',
    notes: 'Capture top 3 outcomes before standup.',
    listId: 'inbox',
    completed: false,
    important: true,
    myDay: true,
    dueDate: '',
    createdAt: Date.now() - 1000 * 60 * 60 * 4
  },
  {
    id: 't-2',
    title: 'Review pull requests',
    notes: '',
    listId: 'inbox',
    completed: false,
    important: false,
    myDay: false,
    dueDate: new Date().toISOString().slice(0, 10),
    createdAt: Date.now() - 1000 * 60 * 90
  }
];

export function buildInitialState() {
  return {
    customLists: [],
    selectedListId: 'inbox',
    filter: 'all',
    query: '',
    tasks: STARTER_TASKS
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return buildInitialState();
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return buildInitialState();
    }

    return {
      customLists: Array.isArray(parsed.customLists) ? parsed.customLists : [],
      selectedListId: typeof parsed.selectedListId === 'string' ? parsed.selectedListId : 'inbox',
      filter: ['all', 'active', 'completed'].includes(parsed.filter) ? parsed.filter : 'all',
      query: typeof parsed.query === 'string' ? parsed.query : '',
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : []
    };
  } catch (_err) {
    return buildInitialState();
  }
}

export function persistState(state) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      customLists: state.customLists,
      selectedListId: state.selectedListId,
      filter: state.filter,
      query: state.query,
      tasks: state.tasks
    })
  );
}

export function isTaskInSelectedList(task, selectedListId) {
  if (selectedListId === 'inbox') {
    return task.listId === 'inbox';
  }
  if (selectedListId === 'my-day') {
    return task.myDay;
  }
  if (selectedListId === 'important') {
    return task.important;
  }
  if (selectedListId === 'planned') {
    return Boolean(task.dueDate);
  }
  if (selectedListId === 'completed') {
    return task.completed;
  }

  return task.listId === selectedListId;
}

export function listCount(listId, tasks) {
  return tasks.filter((task) => isTaskInSelectedList(task, listId) && !task.completed).length;
}

export function formatDueLabel(dateText) {
  if (!dateText) {
    return '';
  }

  const due = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(due.getTime())) {
    return '';
  }

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);

  if (due.getTime() === today.getTime()) {
    return 'Today';
  }
  if (due.getTime() === tomorrow.getTime()) {
    return 'Tomorrow';
  }

  return due.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  });
}

export function createTask(input) {
  return {
    id: `t-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    title: input.title.trim(),
    notes: '',
    listId: input.listId,
    completed: false,
    important: Boolean(input.important),
    myDay: Boolean(input.myDay),
    dueDate: input.dueDate || '',
    createdAt: Date.now()
  };
}

export function createCustomList(name) {
  return {
    id: `list-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    name: name.trim(),
    kind: 'regular',
    locked: false
  };
}
