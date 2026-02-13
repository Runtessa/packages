import React, { useMemo } from 'react';

export function TaskComposer({ selectedList, onCreateTask }) {
  const defaultListId = useMemo(() => {
    if (selectedList && selectedList.kind === 'regular') {
      return selectedList.id;
    }
    return 'inbox';
  }, [selectedList]);

  function handleSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    const title = String(formData.get('title') || '').trim();
    if (!title) {
      return;
    }

    onCreateTask({
      title,
      listId: defaultListId,
      dueDate: String(formData.get('dueDate') || ''),
      important: formData.get('important') === 'on',
      myDay: formData.get('myDay') === 'on'
    });

    form.reset();
  }

  return (
    <form className="task-composer" onSubmit={handleSubmit}>
      <input name="title" type="text" placeholder="Add a task" aria-label="Task title" />
      <input name="dueDate" type="date" aria-label="Due date" />

      <label>
        <input name="important" type="checkbox" />
        Important
      </label>

      <label>
        <input name="myDay" type="checkbox" />
        My Day
      </label>

      <button type="submit">Add Task</button>
    </form>
  );
}
