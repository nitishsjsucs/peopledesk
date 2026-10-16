// Router test helpers: a probe that shows the current location, and a Back button (history -1).
import { useLocation, useNavigate } from "react-router";

export function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <p data-testid="location">{`${location.pathname}${location.search}`}</p>
      <button type="button" onClick={() => navigate(-1)}>
        Test back
      </button>
    </>
  );
}
