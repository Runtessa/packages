import React, { useState } from 'react';

export function Sidebar({ lists, selectedListId, counts, onSelectList, onCreateList }) {
  const [draft, setDraft] = useState('');

  function submitNewList(event) {
    event.preventDefault();
    const name = draft.trim();
    if (!name) {
      return;
    }
    onCreateList(name);
    setDraft('');
  }

  return (
    <aside className="tasks-sidebar">
      <header className="tasks-brand">
        <p className="tasks-brand-eyebrow">Productivity</p>
        <h1>My Tasks</h1>
      </header>

      <nav className="tasks-nav">
        {lists.map((list) => {
          const selected = list.id === selectedListId;
          return (
            <button
              key={list.id}
              type="button"
              onClick={() => onSelectList(list.id)}
              className={`tasks-nav-item ${selected ? 'is-active' : ''}`}
            >
              <span>{list.name}</span>
              <span className="tasks-nav-count">{counts[list.id] ?? 0}</span>
            </button>
          );
        })}
      </nav>

      <form className="tasks-list-form" onSubmit={submitNewList}>
        <input
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="New list"
          aria-label="New list name"
        />
        <button type="submit">Add List</button>
      </form>
    </aside>
  );
}
