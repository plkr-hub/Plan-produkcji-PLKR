# Plan-produkcji-PLKR

## Koszty gazu w planerze

W sekcji **GAZ** można edytować cenę paliwa z TGE (zł/MWh), dopłatę do paliwa oraz
zmienną opłatę dystrybucyjną (zł/MWh). Te stawki są doliczane do zużytych kWh gazu
i przeliczane na m³ w podsumowaniach. Miesięczną opłatę stałą dystrybucyjną
i abonament wpisuje się oddzielnie (zł/mies.); planer rozkłada je proporcjonalnie
na dni miesiąca, a dzienny koszt przypisuje do godzin i produktów według zużycia gazu.
Stawki pozostają edytowalne i są zapisywane lokalnie w przeglądarce. Zmiana stawek
nie aktualizuje wstecz wcześniej zapisanych statystyk.

## Limit ceny dla produkcji

Pole **Limit ceny dla produkcji (zł/MWh)** w sekcji prądu można zmieniać przed
planowaniem. Zmiana natychmiast przelicza harmonogram i zapisuje ustawienie lokalnie
w przeglądarce. Limit uwzględnia dopłatę do prądu i opłatę mocową; włączone wymuszenie
celów dobowych może mimo limitu zaplanować brakującą produkcję w droższych godzinach.