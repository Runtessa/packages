import React from 'react';

export function TaskDetails({ task, lists, onPatchTask, onDeleteTask }) {
  if (!task) {
    return (
      <aside className="task-details empty">
        <h3>Task details</h3>
        <p>Select a task to edit notes, due date, and list assignment.</p>
      </aside>
    );
  }

  return (
    <aside className="task-details">
      <div className="task-details-head">
        <input
          type="text"
          value={task.title}
          onChange={(event) => onPatchTask(task.id, { title: event.target.value })}
          aria-label="Task title"
        />
        <button type="button" className="danger" onClick={() => onDeleteTask(task.id)}>
          Delete
        </button>
      </div>

      <label>
        Notes
        <textarea
          value={task.notes}
          onChange={(event) => onPatchTask(task.id, { notes: event.target.value })}
          placeholder="Add details"
        />
      </label>

      <label>
        Due date
        <input
          type="date"
          value={task.dueDate || ''}
          onChange={(event) => onPatchTask(task.id, { dueDate: event.target.value })}
        />
      </label>

      <label>
        List
        <select value={task.listId} onChange={(event) => onPatchTask(task.id, { listId: event.target.value })}>
          {lists.filter((list) => list.kind === 'regular').map((list) => (
            <option key={list.id} value={list.id}>
              {list.name}
            </option>
          ))}
        </select>
      </label>

      <div className="task-toggles">
        <label>
          <input
            type="checkbox"
            checked={task.completed}
            onChange={(event) => onPatchTask(task.id, { completed: event.target.checked })}
          />
          Completed
        </label>

        <label>
          <input
            type="checkbox"
            checked={task.important}
            onChange={(event) => onPatchTask(task.id, { important: event.target.checked })}
          />
          Important
        </label>

        <label>
          <input
            type="checkbox"
            checked={task.myDay}
            onChange={(event) => onPatchTask(task.id, { myDay: event.target.checked })}
          />
          My Day
        </label>
      </div>
    </aside>
  );
}
