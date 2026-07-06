UPDATE tasks SET brand='Cout De La Liberte', title=REPLACE(title,'KT ','CDLL ') WHERE brand='KT';
UPDATE tasks SET title=REPLACE(title,'completed KT assets','completed CDLL assets') WHERE title LIKE '%KT assets%';
UPDATE tasks SET brand='Cout De La Liberte' WHERE brand='CDLL';
DELETE FROM tasks WHERE id IN ('r05','r07');
