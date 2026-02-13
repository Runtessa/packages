import React, { useEffect, useMemo, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { TaskComposer } from './components/TaskComposer';
import { TaskList } from './components/TaskList';
import { TaskDetails } from './components/TaskDetails';
import {
  BASE_LISTS,
  createCustomList,
  createTask,
  isTaskInSelectedList,
  listCount,
  loadState,
  persistState
} from './lib/state';
import './styles.css';

function byCreatedDesc(a, b) {
  return b.createdAt - a.createdAt;
}

export function App() {
  const [state, setState] = useState(() => loadState());
  const [selectedTaskId, setSelectedTaskId] = useState(null);

  const lists = useMemo(() => [...BASE_LISTS, ...state.customLists], [state.customLists]);

  useEffect(() => {
    persistState(state);
  }, [state]);

  const counts = useMemo(() => {
    return lists.reduce((acc, list) => {
      acc[list.id] = listCount(list.id, state.tasks);
      return acc;
    }, {});
  }, [lists, state.tasks]);

  const selectedList = lists.find((list) => list.id === state.selectedListId) || lists[0];

  const visibleTasks = useMemo(() => {
    return state.tasks
      .filter((task) => isTaskInSelectedList(task, selectedList.id))
      .filter((task) => {
        if (state.filter === 'active') {
          return !task.completed;
        }
        if (state.filter === 'completed') {
          return task.completed;
        }
        return true;
      })
      .filter((task) => {
        if (!state.query.trim()) {
          return true;
        }
        const q = state.query.trim().toLowerCase();
        return task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q);
      })
      .sort(byCreatedDesc);
  }, [selectedList.id, state.filter, state.query, state.tasks]);

  const selectedTask = state.tasks.find((task) => task.id === selectedTaskId) || null;

  function setSelectedList(id) {
    setState((prev) => ({ ...prev, selectedListId: id }));
    setSelectedTaskId(null);
  }

  function addList(name) {
    setState((prev) => {
      if (prev.customLists.some((list) => list.name.toLowerCase() === name.toLowerCase())) {
        return prev;
      }
      const created = createCustomList(name);
      return {
        ...prev,
        customLists: [...prev.customLists, created],
        selectedListId: created.id
      };
    });
  }

  function addTask(input) {
    setState((prev) => ({
      ...prev,
      tasks: [createTask(input), ...prev.tasks]
    }));
  }

  function patchTask(taskId, patch) {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.map((task) => {
        if (task.id !== taskId) {
          return task;
        }
        const nextTitle =
          typeof patch.title === 'string' && patch.title.trim().length > 0 ? patch.title : task.title;
        return { ...task, ...patch, title: nextTitle };
      })
    }));
  }

  function toggleComplete(taskId) {
    const hit = state.tasks.find((task) => task.id === taskId);
    if (!hit) {
      return;
    }
    patchTask(taskId, { completed: !hit.completed });
  }

  function toggleImportant(taskId) {
    const hit = state.tasks.find((task) => task.id === taskId);
    if (!hit) {
      return;
    }
    patchTask(taskId, { important: !hit.important });
  }

  function deleteTask(taskId) {
    setState((prev) => ({
      ...prev,
      tasks: prev.tasks.filter((task) => task.id !== taskId)
    }));
    if (selectedTaskId === taskId) {
      setSelectedTaskId(null);
    }
  }

  return (
    <div className="tasks-app-shell">
      <Sidebar
        lists={lists}
        selectedListId={selectedList.id}
        counts={counts}
        onSelectList={setSelectedList}
        onCreateList={addList}
      />

      <main className="tasks-main">
        <header className="tasks-header">
          <div>
            <h2>{selectedList.name}</h2>
            <p>{counts[selectedList.id] ?? 0} remaining</p>
          </div>

          <div className="tasks-controls">
            <input
              type="search"
              value={state.query}
              onChange={(event) => setState((prev) => ({ ...prev, query: event.target.value }))}
              placeholder="Search tasks"
              aria-label="Search tasks"
            />
            <select
              value={state.filter}
              onChange={(event) => setState((prev) => ({ ...prev, filter: event.target.value }))}
              aria-label="Task filter"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </header>

        <TaskComposer selectedList={selectedList} onCreateTask={addTask} />

        <TaskList
          tasks={visibleTasks}
          selectedTaskId={selectedTaskId}
          onSelectTask={setSelectedTaskId}
          onToggleComplete={toggleComplete}
          onToggleImportant={toggleImportant}
        />
      </main>

      <TaskDetails task={selectedTask} lists={lists} onPatchTask={patchTask} onDeleteTask={deleteTask} />
    </div>
  );
}
