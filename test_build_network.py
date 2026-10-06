from build_network import along, norm


def test_stops_are_measured_along_the_road_in_order():
    road = [(50.0, 4.0), (50.0, 4.01), (50.01, 4.01)]  # east ~715 m, then north ~1113 m
    at = along(road, [(50.0, 4.0), (50.0, 4.005), (50.005, 4.01), (50.01, 4.01)])
    assert at[0] == 0 and abs(at[1] - 357) < 5 and abs(at[2] - 1272) < 10 and abs(at[3] - 1828) < 10


def test_stop_ids_from_both_sources_match():
    assert norm("0473F") == norm("473") == "473"
