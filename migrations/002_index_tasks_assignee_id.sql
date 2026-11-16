-- The existing (assignee, status, id) index cannot order by id when status is unfiltered.
CREATE INDEX tasks_assignee_id ON tasks(assignee, id);
