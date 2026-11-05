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
produkcji może mimo limitu zaplanować pracę w droższych godzinach.

## Plan 14-dniowy: mączka i produkty

Plan godzinowy wybiera najpierw Calcipril lub Granucal według wydajności t/h,
z uwzględnieniem limitu ceny, zamówień i maksymalnego stanu magazynu. Do produkcji
6 t Calciprilu przyjmuje zużycie 1 t mączki, a do 6 t Granucalu — 0,6 t. Mączka
jest planowana tylko w ilości potrzebnej do pokrycia tego zużycia, z limitem 40 t
dziennie oraz własnym stanem i maksymalną pojemnością magazynu. Jej zapas jest
przenoszony między kolejnymi dniami prognozy.