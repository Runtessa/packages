import React from 'react';
import { formatDueLabel } from '../lib/state';

export function TaskList({ tasks, selectedTaskId, onSelectTask, onToggleComplete, onToggleImportant }) {
  if (!tasks.length) {
    return (
      <div className="task-list-empty">
        <h3>No tasks here yet</h3>
        <p>Add your first task to get this list moving.</p>
      </div>
    );
  }

  return (
    <ul className="task-list" role="list">
      {tasks.map((task) => {
        const dueLabel = formatDueLabel(task.dueDate);
        const active = task.id === selectedTaskId;
        return (
          <li key={task.id} className={`task-list-item ${active ? 'is-active' : ''}`}>
            <button
              type="button"
              className={`task-check ${task.completed ? 'is-done' : ''}`}
              onClick={() => onToggleComplete(task.id)}
              aria-label={task.completed ? 'Mark as incomplete' : 'Mark as complete'}
            />

            <button type="button" className="task-main" onClick={() => onSelectTask(task.id)}>
              <span className={`task-title ${task.completed ? 'is-done' : ''}`}>{task.title}</span>
              <span className="task-meta">
                {task.myDay ? <span className="task-chip">My Day</span> : null}
                {dueLabel ? <span className="task-chip">Due {dueLabel}</span> : null}
              </span>
            </button>

            <button
              type="button"
              className={`task-star ${task.important ? 'is-on' : ''}`}
              onClick={() => onToggleImportant(task.id)}
              aria-label={task.important ? 'Remove important' : 'Mark important'}
            >
              ★
            </button>
          </li>
        );
      })}
    </ul>
  );
}
