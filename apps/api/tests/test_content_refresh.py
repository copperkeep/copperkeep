from copperkeep_api.content import should_refresh


def test_a_new_release_refreshes_immediately():
    assert should_refresh("2026.09.4", "2026.09.3", since_full=20, refresh_every=300)


def test_the_same_release_waits_for_the_interval():
    assert not should_refresh("2026.09.3", "2026.09.3", since_full=20, refresh_every=300)
    assert should_refresh("2026.09.3", "2026.09.3", since_full=300, refresh_every=300)


def test_an_unreachable_service_is_not_a_new_release():
    assert not should_refresh(None, "2026.09.3", since_full=20, refresh_every=300)
    assert should_refresh(None, "2026.09.3", since_full=300, refresh_every=300)


def test_first_load_after_a_failed_startup_refreshes():
    assert should_refresh("2026.09.3", None, since_full=20, refresh_every=300)
