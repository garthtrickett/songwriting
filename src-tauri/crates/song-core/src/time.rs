use crate::{Error, Result, ensure};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

/// Exact quarter-note units, with the same JSON bounds as the existing editor.
/// i128 intermediates cover sums/products of two bounded i64 fractions.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "[i64; 2]", into = "[i64; 2]")]
pub struct Time(i64, i64);

impl Time {
    pub const ZERO: Self = Self(0, 1);
    pub fn new(n: i64, d: i64) -> Result<Self> {
        ensure(
            n.unsigned_abs() <= MAX_SAFE_INTEGER as u64 && d > 0 && d <= MAX_SAFE_INTEGER,
            "Time requires safe integer numerator and positive denominator",
        )?;
        Self::ratio(i128::from(n), i128::from(d))
    }
    fn ratio(n: i128, d: i128) -> Result<Self> {
        let (mut a, mut b) = (n.abs(), d);
        while b != 0 {
            (a, b) = (b, a % b);
        }
        let (n, d) = (n / a, d / a);
        if n.abs() > i128::from(MAX_SAFE_INTEGER) || d > i128::from(MAX_SAFE_INTEGER) {
            return Err(Error::new(
                "invalid",
                "Musical time exceeds exact arithmetic bounds",
            ));
        }
        Ok(Self(n as i64, d as i64))
    }
    pub fn checked_add(self, rhs: Self) -> Result<Self> {
        Self::ratio(
            i128::from(self.0) * i128::from(rhs.1) + i128::from(rhs.0) * i128::from(self.1),
            i128::from(self.1) * i128::from(rhs.1),
        )
    }
    pub fn checked_sub(self, rhs: Self) -> Result<Self> {
        self.checked_add(Self(-rhs.0, rhs.1))
    }
    pub fn checked_mul(self, rhs: Self) -> Result<Self> {
        Self::ratio(
            i128::from(self.0) * i128::from(rhs.0),
            i128::from(self.1) * i128::from(rhs.1),
        )
    }
}
impl Ord for Time {
    fn cmp(&self, rhs: &Self) -> Ordering {
        (i128::from(self.0) * i128::from(rhs.1)).cmp(&(i128::from(rhs.0) * i128::from(self.1)))
    }
}
impl PartialOrd for Time {
    fn partial_cmp(&self, rhs: &Self) -> Option<Ordering> {
        Some(self.cmp(rhs))
    }
}
impl From<Time> for [i64; 2] {
    fn from(t: Time) -> Self {
        [t.0, t.1]
    }
}
impl TryFrom<[i64; 2]> for Time {
    type Error = Error;
    fn try_from(v: [i64; 2]) -> Result<Self> {
        let t = Self::new(v[0], v[1])?;
        ensure(
            <[i64; 2]>::from(t) == v,
            "Time fractions must be normalized",
        )?;
        Ok(t)
    }
}
