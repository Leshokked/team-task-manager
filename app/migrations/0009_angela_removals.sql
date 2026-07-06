DELETE FROM tasks WHERE person='angela' AND (brand='Bronco' OR (brand='AUTEUR' AND (title LIKE '%email%' OR title LIKE '%Email%')));
